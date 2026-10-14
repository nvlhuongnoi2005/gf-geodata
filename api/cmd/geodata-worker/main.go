// geodata-worker claims conversion work from the catalog. It is deliberately
// separate from the browser-facing upload API: S3 object keys and credentials
// stay inside the cluster, and a crash leaves an auditable failed job.
package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/catalog"
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/tilestore"
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/tiling"
)

var errConversionCanceled = errors.New("conversion canceled")

type worker struct {
	store           *catalog.Store
	objectStore     *s3.Client
	downloader      *manager.Downloader
	uploader        *manager.Uploader
	rawBucket       string
	derivedBucket   string
	publishedBucket string
	workspaceRoot   string
	converter       *tiling.Converter
}

func required(name string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		log.Fatalf("required environment variable %s is not set", name)
	}
	return value
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store := openCatalog(ctx)
	defer store.Close()
	app := &worker{store: store, rawBucket: required("S3_RAW_BUCKET"), derivedBucket: required("S3_DERIVED_BUCKET"), publishedBucket: required("S3_PUBLISHED_BUCKET"), workspaceRoot: environmentOr("WORKSPACE_ROOT", "/work")}
	app.objectStore = openS3(ctx)
	app.downloader = manager.NewDownloader(app.objectStore, func(d *manager.Downloader) { d.Concurrency = 2; d.PartSize = 64 * 1024 * 1024 })
	app.uploader = manager.NewUploader(app.objectStore, func(u *manager.Uploader) { u.Concurrency = 2; u.PartSize = 64 * 1024 * 1024 })
	app.converter = tiling.New(tiling.Tools{
		Tilemaker:        environmentOr("TILEMAKER_BIN", "/usr/src/app/tilemaker"),
		Ogr2Ogr:          environmentOr("OGR2OGR_BIN", "ogr2ogr"),
		GdalTranslate:    environmentOr("GDAL_TRANSLATE_BIN", "gdal_translate"),
		OSMConfigPath:    environmentOr("TILEMAKER_CONFIG_PATH", "/usr/src/app/resources/config-openmaptiles.json"),
		OSMProcessPath:   environmentOr("TILEMAKER_PROCESS_PATH", "/usr/src/app/resources/process-openmaptiles.lua"),
		RasterTileFormat: environmentOr("RASTER_TILE_FORMAT", "PNG"),
	})

	pollEvery := durationOr("JOB_POLL_INTERVAL", 5*time.Second)
	slog.Info("geodata conversion worker started", "poll_interval", pollEvery.String())
	for {
		if !app.processOne(ctx) && !app.publishOne(ctx) {
			select {
			case <-ctx.Done():
				slog.Info("geodata conversion worker stopped")
				return
			case <-time.After(pollEvery):
			}
		}
	}
}

func openCatalog(ctx context.Context) *catalog.Store {
	cfg := catalog.Config{
		Host: required("POSTGRES_HOST"), Port: os.Getenv("POSTGRES_PORT"), Database: required("POSTGRES_DATABASE"),
		User: required("POSTGRES_USER"), Password: required("POSTGRES_PASSWORD"), SSLMode: os.Getenv("POSTGRES_SSLMODE"),
	}
	deadline := time.Now().Add(75 * time.Second)
	for {
		attemptCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		store, err := catalog.Open(attemptCtx, cfg)
		if err == nil {
			err = store.Migrate(attemptCtx)
		}
		cancel()
		if err == nil {
			return store
		}
		if store != nil {
			store.Close()
		}
		if time.Now().After(deadline) {
			log.Fatalf("connect or migrate geodata catalog: %v", err)
		}
		slog.Warn("geodata catalog is not ready; retrying", "error", err)
		select {
		case <-ctx.Done():
			log.Fatal("worker stopped before catalog became ready")
		case <-time.After(3 * time.Second):
		}
	}
}

func openS3(ctx context.Context) *s3.Client {
	region := environmentOr("S3_REGION", "us-east-1")
	accessKey, secretKey := required("S3_ACCESS_KEY"), required("S3_SECRET_KEY")
	base, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) {
			return aws.Credentials{AccessKeyID: accessKey, SecretAccessKey: secretKey, Source: "geodata-worker-secret"}, nil
		})),
	)
	if err != nil {
		log.Fatalf("configure S3 client: %v", err)
	}
	return s3.NewFromConfig(base, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(required("S3_ENDPOINT"))
		options.UsePathStyle = true
	})
}

func (w *worker) processOne(parent context.Context) bool {
	ctx, cancel := context.WithTimeout(parent, 20*time.Second)
	job, err := w.store.ClaimConversionJob(ctx)
	cancel()
	if err != nil {
		slog.Error("claim conversion job", "error", err)
		return false
	}
	if job == nil {
		return false
	}

	slog.Info("processing conversion job", "job_id", job.ID, "format", job.SourceFormat)
	if err := w.runJob(parent, job); err != nil {
		if errors.Is(err, errConversionCanceled) {
			slog.Info("conversion job canceled", "job_id", job.ID)
			return true
		}
		slog.Error("conversion job failed", "job_id", job.ID, "error", err)
		failCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		if failErr := w.store.FailConversionJob(failCtx, job.ID, err.Error()); failErr != nil {
			slog.Error("mark conversion job failed", "job_id", job.ID, "error", failErr)
		}
		cancel()
		return true
	}
	slog.Info("conversion job completed", "job_id", job.ID)
	return true
}

func (w *worker) publishOne(parent context.Context) bool {
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	release, artifacts, err := w.store.ClaimReleasePublish(ctx)
	cancel()
	if err != nil {
		slog.Error("claim release publish", "error", err)
		return false
	}
	if release == nil {
		return false
	}
	for _, artifact := range artifacts {
		if err := w.publishArtifact(parent, release.ID, &artifact); err != nil {
			slog.Error("publish release failed", "release_id", release.ID, "error", err)
			failCtx, stop := context.WithTimeout(context.Background(), 20*time.Second)
			_ = w.store.FailReleasePublish(failCtx, release.ID, err.Error())
			stop()
			return true
		}
	}
	finishCtx, stop := context.WithTimeout(parent, 20*time.Second)
	err = w.store.FinishReleasePublish(finishCtx, release.ID)
	stop()
	if err != nil {
		slog.Error("finish release publish", "release_id", release.ID, "error", err)
	}
	return true
}

func (w *worker) publishArtifact(ctx context.Context, releaseID string, artifact *catalog.ReleaseArtifact) error {
	workspace, err := os.MkdirTemp(w.workspaceRoot, "release-"+releaseID+"-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(workspace)
	path := filepath.Join(workspace, "artifact.mbtiles")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, downloadErr := w.downloader.Download(ctx, file, &s3.GetObjectInput{Bucket: aws.String(w.derivedBucket), Key: aws.String(artifact.OutputObjectKey)})
	closeErr := file.Close()
	if downloadErr != nil {
		return fmt.Errorf("download derived artifact: %w", downloadErr)
	}
	if closeErr != nil {
		return closeErr
	}
	prefix := fmt.Sprintf("releases/%s/artifacts/%s", releaseID, artifact.ArtifactID)
	format := "pbf"
	extension := "pbf"
	contentType := "application/vnd.mapbox-vector-tile"
	if err := tilestore.Export(ctx, path, func(tile tilestore.Tile) error {
		key := fmt.Sprintf("%s/tiles/%d/%d/%d.%s", prefix, tile.Z, tile.X, tile.Y, extension)
		_, err := w.objectStore.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(w.publishedBucket), Key: aws.String(key), Body: bytes.NewReader(tile.Data), ContentType: aws.String(contentType), CacheControl: aws.String("public, max-age=31536000, immutable")})
		return err
	}); err != nil {
		return fmt.Errorf("publish tile objects: %w", err)
	}
	artifact.TilePrefix, artifact.TileFormat = prefix, format
	storeCtx, stop := context.WithTimeout(ctx, 20*time.Second)
	defer stop()
	return w.store.CompleteReleasePublish(storeCtx, releaseID, *artifact)
}

func (w *worker) runJob(ctx context.Context, job *catalog.ConversionJob) error {
	jobCtx, wasCanceled, stopWatching := w.watchForCancellation(ctx, job.ID)
	defer stopWatching()

	workspace, err := os.MkdirTemp(w.workspaceRoot, "job-"+job.ID+"-")
	if err != nil {
		return fmt.Errorf("create workspace: %w", err)
	}
	defer os.RemoveAll(workspace)

	sourcePath := filepath.Join(workspace, "source"+sourceExtension(job.SourceFormat))
	if err := w.download(jobCtx, job.RawObjectKey, sourcePath); err != nil {
		if wasCanceled() {
			return errConversionCanceled
		}
		return err
	}
	if wasCanceled() {
		return errConversionCanceled
	}
	if err := w.updateProgress(jobCtx, job.ID, 20, "converting"); err != nil {
		if wasCanceled() {
			return errConversionCanceled
		}
		return err
	}
	outputPath := filepath.Join(workspace, "output.mbtiles")
	stopMonitoring := w.monitorConversionProgress(jobCtx, job)
	if err := w.converter.Convert(jobCtx, tiling.Request{
		SourcePath: sourcePath, SourceType: job.SourceFormat, OutputPath: outputPath, Workspace: workspace,
		MinZoom: job.MinZoom, MaxZoom: job.MaxZoom, LayerName: job.LayerName,
	}); err != nil {
		stopMonitoring()
		if wasCanceled() {
			return errConversionCanceled
		}
		return fmt.Errorf("convert source: %w", err)
	}
	stopMonitoring()
	if wasCanceled() {
		return errConversionCanceled
	}
	if err := w.updateProgress(jobCtx, job.ID, 90, "publishing"); err != nil {
		if wasCanceled() {
			return errConversionCanceled
		}
		return err
	}
	objectKey := fmt.Sprintf("mbtiles/%s/%s.mbtiles", job.RawUploadID, job.ID)
	if err := w.upload(jobCtx, objectKey, outputPath); err != nil {
		if wasCanceled() {
			return errConversionCanceled
		}
		return err
	}
	if wasCanceled() {
		w.deleteDerivedObject(objectKey)
		return errConversionCanceled
	}
	completeCtx, cancel := context.WithTimeout(jobCtx, 20*time.Second)
	defer cancel()
	if err := w.store.CompleteConversionJob(completeCtx, job.ID, objectKey); err != nil {
		w.deleteDerivedObject(objectKey)
		if w.jobWasCanceled(job.ID) {
			return errConversionCanceled
		}
		return fmt.Errorf("record completed conversion: %w", err)
	}
	return nil
}

// watchForCancellation turns the durable catalog cancellation state into a
// canceled context. exec.CommandContext then stops Tilemaker/GDAL instead of
// waiting for the current conversion to finish.
func (w *worker) watchForCancellation(parent context.Context, jobID string) (context.Context, func() bool, func()) {
	jobCtx, stop := context.WithCancel(parent)
	var canceled atomic.Bool
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-jobCtx.Done():
				return
			case <-ticker.C:
				checkCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				isCanceled, err := w.store.IsConversionJobCanceled(checkCtx, jobID)
				cancel()
				if err != nil {
					slog.Warn("check conversion cancellation", "job_id", jobID, "error", err)
					continue
				}
				if isCanceled {
					canceled.Store(true)
					stop()
					return
				}
			}
		}
	}()
	return jobCtx, canceled.Load, func() { stop(); <-done }
}

func (w *worker) jobWasCanceled(jobID string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	canceled, err := w.store.IsConversionJobCanceled(ctx, jobID)
	return err == nil && canceled
}

func (w *worker) deleteDerivedObject(objectKey string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if _, err := w.objectStore.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(w.derivedBucket), Key: aws.String(objectKey)}); err != nil {
		slog.Warn("remove canceled conversion output", "object_key", objectKey, "error", err)
	}
}

func (w *worker) updateProgress(parent context.Context, jobID string, progress int, step string) error {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	return w.store.UpdateConversionProgress(ctx, jobID, progress, step)
}

// Tilemaker does not emit a stable machine-readable percent. During its long
// conversion phase, derive a bounded estimate from prior comparable jobs. The
// UI receives no estimate at all until enough historical data exists.
func (w *worker) monitorConversionProgress(parent context.Context, job *catalog.ConversionJob) func() {
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if job.EstimatedSeconds == nil || *job.EstimatedSeconds < 1 || job.StartedAt == nil {
					continue
				}
				elapsed := time.Since(*job.StartedAt).Seconds()
				ratio := elapsed / float64(*job.EstimatedSeconds)
				progress := min(85, 20+int(65*ratio))
				if progress > 20 {
					_ = w.updateProgress(ctx, job.ID, progress, "converting")
				}
			}
		}
	}()
	return func() { cancel(); <-done }
}

func (w *worker) download(ctx context.Context, objectKey, destination string) error {
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open local source: %w", err)
	}
	_, downloadErr := w.downloader.Download(ctx, file, &s3.GetObjectInput{Bucket: aws.String(w.rawBucket), Key: aws.String(objectKey)})
	closeErr := file.Close()
	if downloadErr != nil {
		return fmt.Errorf("download raw source: %w", downloadErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close downloaded source: %w", closeErr)
	}
	return nil
}

func (w *worker) upload(ctx context.Context, objectKey, sourcePath string) error {
	file, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("open converted artifact: %w", err)
	}
	defer file.Close()
	_, err = w.uploader.Upload(ctx, &s3.PutObjectInput{
		Bucket: aws.String(w.derivedBucket), Key: aws.String(objectKey), Body: file,
		ContentType: aws.String("application/x-sqlite3"),
		Metadata:    map[string]string{"format": "mbtiles"},
	})
	if err != nil {
		return fmt.Errorf("upload converted artifact: %w", err)
	}
	return nil
}

func sourceExtension(format string) string {
	switch format {
	case tiling.FormatOSMPBF:
		return ".osm.pbf"
	case tiling.FormatGeoTIFF:
		return ".tif"
	case tiling.FormatGeoPackage:
		return ".gpkg"
	case tiling.FormatShapefileZip:
		return ".zip"
	case tiling.FormatMBTiles:
		return ".mbtiles"
	default:
		return ".bin"
	}
}

func environmentOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func durationOr(name string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		log.Printf("invalid %s=%q; using %s", name, value, fallback)
		return fallback
	}
	return parsed
}
