// geodata-worker claims conversion work from the catalog. It is deliberately
// separate from the browser-facing upload API: S3 object keys and credentials
// stay inside the cluster, and a crash leaves an auditable failed job.
package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"net/http"
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
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/mbtiles"
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/tiling"
)

var errConversionCanceled = errors.New("conversion canceled")

type worker struct {
	store         *catalog.Store
	objectStore   *s3.Client
	downloader    *manager.Downloader
	uploader      *manager.Uploader
	rawBucket     string
	derivedBucket string
	workspaceRoot string
	tileCacheRoot string
	tileServerURL string
	converter     *tiling.Converter
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
	mode := environmentOr("WORKER_MODE", "conversion")
	if mode != "conversion" && mode != "tileserver-cache-warmer" {
		log.Fatalf("WORKER_MODE must be conversion or tileserver-cache-warmer")
	}
	app := &worker{store: store, derivedBucket: required("S3_DERIVED_BUCKET"), workspaceRoot: environmentOr("WORKSPACE_ROOT", "/work")}
	app.objectStore = openS3(ctx)
	app.downloader = manager.NewDownloader(app.objectStore, func(d *manager.Downloader) { d.Concurrency = 2; d.PartSize = 64 * 1024 * 1024 })
	if mode == "conversion" {
		app.rawBucket = required("S3_RAW_BUCKET")
		app.uploader = manager.NewUploader(app.objectStore, func(u *manager.Uploader) { u.Concurrency = 2; u.PartSize = 64 * 1024 * 1024 })
		app.converter = tiling.New(tiling.Tools{
			Tilemaker:        environmentOr("TILEMAKER_BIN", "/usr/src/app/tilemaker"),
			Ogr2Ogr:          environmentOr("OGR2OGR_BIN", "ogr2ogr"),
			GdalTranslate:    environmentOr("GDAL_TRANSLATE_BIN", "gdal_translate"),
			OSMConfigPath:    environmentOr("TILEMAKER_CONFIG_PATH", "/usr/src/app/resources/config-openmaptiles.json"),
			OSMProcessPath:   environmentOr("TILEMAKER_PROCESS_PATH", "/usr/src/app/resources/process-openmaptiles.lua"),
			RasterTileFormat: environmentOr("RASTER_TILE_FORMAT", "PNG"),
		})
	} else {
		app.tileCacheRoot = required("TILE_SERVER_CACHE_ROOT")
		app.tileServerURL = strings.TrimRight(required("TILE_SERVER_INTERNAL_URL"), "/")
	}

	pollEvery := durationOr("JOB_POLL_INTERVAL", 5*time.Second)
	slog.Info("geodata worker started", "mode", mode, "poll_interval", pollEvery.String())
	for {
		worked := false
		if mode == "tileserver-cache-warmer" {
			worked = app.warmOne(ctx)
			if !worked {
				// Compatibility path for drafts created before artifact warming.
				worked = app.publishOne(ctx)
			}
		} else {
			worked = app.processOne(ctx)
		}
		if !worked {
			select {
			case <-ctx.Done():
				slog.Info("geodata worker stopped", "mode", mode)
				return
			case <-time.After(pollEvery):
			}
		}
	}
}

func (w *worker) warmOne(parent context.Context) bool {
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	artifact, err := w.store.ClaimCacheArtifact(ctx)
	cancel()
	if err != nil {
		slog.Error("claim artifact cache warm", "error", err)
		return false
	}
	if artifact == nil {
		return false
	}
	warmed, err := w.warmArtifact(parent, artifact.ID, artifact.OutputObjectKey)
	if err != nil {
		slog.Error("warm artifact cache failed", "artifact_id", artifact.ID, "error", err)
		failCtx, stop := context.WithTimeout(context.Background(), 20*time.Second)
		_ = w.store.FailArtifactCache(failCtx, artifact.ID, err.Error())
		stop()
		return true
	}
	completeCtx, stop := context.WithTimeout(parent, 20*time.Second)
	err = w.store.CompleteArtifactCache(completeCtx, *artifact, warmed)
	stop()
	if err != nil {
		slog.Error("record warmed artifact", "artifact_id", artifact.ID, "error", err)
	}
	return true
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
	warmed, err := w.warmArtifact(ctx, artifact.ArtifactID, artifact.OutputObjectKey)
	if err != nil {
		return err
	}
	warmed.ReleaseID = releaseID
	storeCtx, stop := context.WithTimeout(ctx, 20*time.Second)
	defer stop()
	return w.store.CompleteReleasePublish(storeCtx, releaseID, warmed)
}

func (w *worker) warmArtifact(ctx context.Context, artifactID, outputObjectKey string) (catalog.ReleaseArtifact, error) {
	if err := os.MkdirAll(w.tileCacheRoot, 0o750); err != nil {
		return catalog.ReleaseArtifact{}, fmt.Errorf("create TileServer cache root: %w", err)
	}
	dataset := "geodata-" + strings.ReplaceAll(artifactID, "-", "")
	target := filepath.Join(w.tileCacheRoot, dataset+".mbtiles")
	file, err := os.CreateTemp(w.tileCacheRoot, "."+dataset+"-*.mbtiles")
	if err != nil {
		return catalog.ReleaseArtifact{}, fmt.Errorf("create temporary TileServer artifact: %w", err)
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	if err := file.Chmod(0o640); err != nil {
		_ = file.Close()
		return catalog.ReleaseArtifact{}, err
	}
	_, downloadErr := w.downloader.Download(ctx, file, &s3.GetObjectInput{Bucket: aws.String(w.derivedBucket), Key: aws.String(outputObjectKey)})
	if syncErr := file.Sync(); syncErr != nil && downloadErr == nil {
		downloadErr = syncErr
	}
	closeErr := file.Close()
	if downloadErr != nil {
		return catalog.ReleaseArtifact{}, fmt.Errorf("download derived artifact into TileServer cache: %w", downloadErr)
	}
	if closeErr != nil {
		return catalog.ReleaseArtifact{}, closeErr
	}
	metadata, err := mbtiles.ReadMetadata(ctx, temporary)
	if err != nil {
		return catalog.ReleaseArtifact{}, fmt.Errorf("read cached MBTiles metadata: %w", err)
	}
	bounds, err := json.Marshal(metadata.Bounds.Values())
	if err != nil {
		return catalog.ReleaseArtifact{}, fmt.Errorf("encode tile bounds: %w", err)
	}
	vectorLayers, err := json.Marshal(metadata.VectorLayers)
	if err != nil {
		return catalog.ReleaseArtifact{}, fmt.Errorf("encode vector layer metadata: %w", err)
	}
	// Rename on the shared PVC is atomic. TileServer only ever observes a
	// complete SQLite file, never the temporary download.
	if err := os.Rename(temporary, target); err != nil {
		return catalog.ReleaseArtifact{}, fmt.Errorf("activate TileServer artifact: %w", err)
	}
	if err := w.restartTileServer(ctx); err != nil {
		return catalog.ReleaseArtifact{}, err
	}
	if err := w.waitForTileServer(ctx, dataset); err != nil {
		return catalog.ReleaseArtifact{}, err
	}
	return catalog.ReleaseArtifact{ArtifactID: artifactID, TileServerDataset: dataset, TileFormat: metadata.Format, MinZoom: metadata.MinZoom, MaxZoom: metadata.MaxZoom, Bounds: bounds, VectorLayers: vectorLayers}, nil
}

// The WebGIS TileServer image indexes MBTiles at process start. A narrowly
// scoped Kubernetes Role lets the warmer roll just that deployment after an
// atomic cache update; waitForTileServer below confirms the new catalog.
func (w *worker) restartTileServer(ctx context.Context) error {
	if strings.EqualFold(environmentOr("TILE_SERVER_RESTART_ENABLED", "false"), "false") {
		return nil
	}
	token, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/token")
	if err != nil {
		return fmt.Errorf("read TileServer restart token: %w", err)
	}
	certificate, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
	if err != nil {
		return fmt.Errorf("read Kubernetes service CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(certificate) {
		return errors.New("parse Kubernetes service CA")
	}
	payload := []byte(`{"spec":{"template":{"metadata":{"annotations":{"geodata.nvlhuongnoi2005/cache-warmed-at":"` + time.Now().UTC().Format(time.RFC3339Nano) + `"}}}}}`)
	namespace := environmentOr("TILE_SERVER_NAMESPACE", "webgis")
	name := environmentOr("TILE_SERVER_DEPLOYMENT", "tile-server")
	endpoint := "https://kubernetes.default.svc/apis/apps/v1/namespaces/" + namespace + "/deployments/" + name
	request, err := http.NewRequestWithContext(ctx, http.MethodPatch, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))
	request.Header.Set("Content-Type", "application/merge-patch+json")
	client := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("request TileServer restart: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("request TileServer restart: %s", response.Status)
	}
	return nil
}

// waitForTileServer is both the cache warm verification and the registration
// barrier. A release becomes visible only after TileServer has indexed the
// newly atomically-written MBTiles file.
func (w *worker) waitForTileServer(parent context.Context, dataset string) error {
	deadline := time.Now().Add(durationOr("TILE_SERVER_WARM_TIMEOUT", 2*time.Minute))
	url := w.tileServerURL + "/datas/" + dataset + ".json"
	client := &http.Client{Timeout: 5 * time.Second}
	var lastErr error
	for time.Now().Before(deadline) {
		request, err := http.NewRequestWithContext(parent, http.MethodGet, url, nil)
		if err != nil {
			return err
		}
		response, err := client.Do(request)
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return nil
			}
			lastErr = fmt.Errorf("TileServer returned %s for dataset %s", response.Status, dataset)
		} else {
			lastErr = err
		}
		select {
		case <-parent.Done():
			return parent.Err()
		case <-time.After(2 * time.Second):
		}
	}
	if lastErr == nil {
		return fmt.Errorf("TileServer did not register dataset %s before warm timeout", dataset)
	}
	return fmt.Errorf("TileServer did not register dataset %s before warm timeout: %w", dataset, lastErr)
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
	if err := w.converter.Convert(jobCtx, tiling.Request{
		SourcePath: sourcePath, SourceType: job.SourceFormat, OutputPath: outputPath, Workspace: workspace,
		MinZoom: job.MinZoom, MaxZoom: job.MaxZoom, LayerName: job.LayerName,
	}); err != nil {
		if wasCanceled() {
			return errConversionCanceled
		}
		return fmt.Errorf("convert source: %w", err)
	}
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
