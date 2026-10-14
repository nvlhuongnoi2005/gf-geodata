package catalog

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

var dataTypes = map[string]struct{}{
	"street": {}, "satellite": {}, "administrative": {}, "topographic": {},
	"land_use": {}, "hydrology": {}, "other": {},
}

type Config struct {
	Host, Port, Database, User, Password, SSLMode string
}

type Store struct {
	pool *pgxpool.Pool
}

var (
	ErrRawUploadNotFound         = errors.New("raw upload not found")
	ErrConversionJobNotFound     = errors.New("conversion job not found")
	ErrConversionJobNotActive    = errors.New("conversion job is not active")
	ErrConversionJobNotRemovable = errors.New("conversion job is not removable")
)

// RawUpload is the safe catalog view returned to the browser. Storage paths and
// account details deliberately remain private to this package.
type RawUpload struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	DataType  string    `json:"dataType"`
	FileName  string    `json:"fileName"`
	Format    string    `json:"format"`
	ByteSize  int64     `json:"byteSize"`
	SHA256    string    `json:"sha256"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

// ConversionJob is an internal work item. RawObjectKey is intentionally not
// exposed through the HTTP API; only the worker needs it to read from S3.
type ConversionJob struct {
	ID               string
	RawUploadID      string
	SourceFileName   string
	SourceFormat     string
	RawObjectKey     string
	Status           string
	MinZoom          int
	MaxZoom          int
	LayerName        string
	SourceByteSize   int64
	Progress         int
	CurrentStep      string
	EstimatedSeconds *int
	OutputObjectKey  string
	FailureMessage   string
	CreatedAt        time.Time
	StartedAt        *time.Time
	FinishedAt       *time.Time
}

type JobCounts struct {
	Queued  int
	Running int
	Failed  int
}

// ConversionJobView is safe for the user interface. It contains catalog names
// and progress state, never S3 keys, credentials, or worker diagnostics.
type ConversionJobView struct {
	ID               string     `json:"id"`
	RawUploadID      string     `json:"rawUploadId"`
	SourceName       string     `json:"sourceName"`
	SourceFile       string     `json:"sourceFileName"`
	SourceFormat     string     `json:"sourceFormat"`
	Status           string     `json:"status"`
	MinZoom          int        `json:"minZoom"`
	MaxZoom          int        `json:"maxZoom"`
	LayerName        string     `json:"layerName,omitempty"`
	Progress         int        `json:"progress"`
	CurrentStep      string     `json:"currentStep"`
	EstimatedSeconds *int       `json:"estimatedDurationSeconds,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	StartedAt        *time.Time `json:"startedAt"`
	FinishedAt       *time.Time `json:"finishedAt"`
}

// ConversionArtifactView is the safe, browser-facing metadata for a successful
// MBTiles conversion. Object keys stay in ConversionArtifact only.
type ConversionArtifactView struct {
	ID           string    `json:"id"`
	SourceName   string    `json:"sourceName"`
	OutputFormat string    `json:"outputFormat"`
	MinZoom      int       `json:"minZoom"`
	MaxZoom      int       `json:"maxZoom"`
	CreatedAt    time.Time `json:"createdAt"`
}

type ConversionArtifact struct {
	ConversionArtifactView
	OutputObjectKey string
}

type MapRelease struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Slug        string     `json:"slug"`
	Description string     `json:"description"`
	Visibility  string     `json:"visibility"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	PublishedAt *time.Time `json:"publishedAt"`
}

type ReleaseArtifact struct {
	ReleaseID, ArtifactID, SourceName, OutputObjectKey string
	TilePrefix, TileFormat                             string
	MinZoom, MaxZoom                                   int
}

type NewRawUpload struct {
	RawUpload
	ObjectKey string
	CreatedBy string
}

func Open(ctx context.Context, cfg Config) (*Store, error) {
	if cfg.Port == "" {
		cfg.Port = "5432"
	}
	if cfg.SSLMode == "" {
		cfg.SSLMode = "disable"
	}
	u := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(cfg.User, cfg.Password),
		Host:   net.JoinHostPort(cfg.Host, cfg.Port),
		Path:   "/" + cfg.Database,
	}
	query := u.Query()
	query.Set("sslmode", cfg.SSLMode)
	u.RawQuery = query.Encode()
	dsn := u.String()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Migrate(ctx context.Context) error {
	paths, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("find catalog migrations: %w", err)
	}
	for _, path := range paths {
		body, err := migrations.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read catalog migration %s: %w", path, err)
		}
		if _, err := s.pool.Exec(ctx, string(body)); err != nil {
			return fmt.Errorf("apply catalog migration %s: %w", path, err)
		}
	}
	return nil
}

func (s *Store) Health(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) CountRawUploads(ctx context.Context) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM raw_uploads").Scan(&count)
	return count, err
}

func (s *Store) JobCounts(ctx context.Context) (JobCounts, error) {
	var counts JobCounts
	err := s.pool.QueryRow(ctx, `
SELECT
  COUNT(*) FILTER (WHERE status = 'queued'),
  COUNT(*) FILTER (WHERE status = 'running'),
  COUNT(*) FILTER (WHERE status = 'failed')
FROM conversion_jobs`).Scan(&counts.Queued, &counts.Running, &counts.Failed)
	return counts, err
}

func IsDataType(value string) bool {
	_, ok := dataTypes[value]
	return ok
}

func SourceFormat(fileName string) (string, bool) {
	name := strings.ToLower(fileName)
	switch {
	case strings.HasSuffix(name, ".osm.pbf"):
		return "osm_pbf", true
	case strings.HasSuffix(name, ".tif"), strings.HasSuffix(name, ".tiff"):
		return "geotiff", true
	case strings.HasSuffix(name, ".gpkg"):
		return "geopackage", true
	case strings.HasSuffix(name, ".zip"):
		return "shapefile_zip", true
	case strings.HasSuffix(name, ".mbtiles"):
		return "mbtiles", true
	default:
		return "", false
	}
}

func (s *Store) Create(ctx context.Context, record NewRawUpload) error {
	_, err := s.pool.Exec(ctx, `
INSERT INTO raw_uploads (
  id, display_name, data_type, source_file_name, source_format, raw_object_key,
  byte_size, sha256, status, created_by, created_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, ''), $11)`,
		record.ID, record.Name, record.DataType, record.FileName, record.Format,
		record.ObjectKey, record.ByteSize, record.SHA256, record.Status,
		record.CreatedBy, record.CreatedAt)
	return err
}

func (s *Store) List(ctx context.Context, limit int) ([]RawUpload, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, display_name, data_type, source_file_name, source_format, byte_size,
       sha256, status, created_at
FROM raw_uploads
ORDER BY created_at DESC
LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]RawUpload, 0)
	for rows.Next() {
		var item RawUpload
		if err := rows.Scan(&item.ID, &item.Name, &item.DataType, &item.FileName,
			&item.Format, &item.ByteSize, &item.SHA256, &item.Status, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) RawObjectKey(ctx context.Context, id string) (string, error) {
	var objectKey string
	err := s.pool.QueryRow(ctx, "SELECT raw_object_key FROM raw_uploads WHERE id = $1", id).Scan(&objectKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrRawUploadNotFound
	}
	return objectKey, err
}

func (s *Store) Delete(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, "DELETE FROM raw_uploads WHERE id = $1", id)
	return err
}

func (s *Store) CreateConversionJob(ctx context.Context, id, rawUploadID string, minZoom, maxZoom int, layerName string) (ConversionJob, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ConversionJob{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var status string
	err = tx.QueryRow(ctx, `SELECT status FROM raw_uploads WHERE id = $1 FOR UPDATE`, rawUploadID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ConversionJob{}, ErrRawUploadNotFound
	}
	if err != nil {
		return ConversionJob{}, err
	}
	if status != "uploaded" && status != "failed" && status != "converted" {
		return ConversionJob{}, ErrConversionJobNotActive
	}

	var job ConversionJob
	err = tx.QueryRow(ctx, `
INSERT INTO conversion_jobs (id, raw_upload_id, min_zoom, max_zoom, layer_name)
VALUES ($1, $2, $3, $4, NULLIF($5, ''))
RETURNING id, raw_upload_id, status, min_zoom, max_zoom, COALESCE(layer_name, ''), progress, current_step, created_at`,
		id, rawUploadID, minZoom, maxZoom, layerName,
	).Scan(&job.ID, &job.RawUploadID, &job.Status, &job.MinZoom, &job.MaxZoom, &job.LayerName, &job.Progress, &job.CurrentStep, &job.CreatedAt)
	if err != nil {
		return ConversionJob{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE raw_uploads SET status = 'converting' WHERE id = $1`, rawUploadID); err != nil {
		return ConversionJob{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ConversionJob{}, err
	}
	return job, nil
}

func (s *Store) ListConversionJobs(ctx context.Context, limit int) ([]ConversionJobView, error) {
	rows, err := s.pool.Query(ctx, `
SELECT j.id, j.raw_upload_id, r.display_name, r.source_file_name, r.source_format,
       j.status, j.min_zoom, j.max_zoom, COALESCE(j.layer_name, ''), j.progress, j.current_step, j.estimated_duration_seconds, j.created_at,
       j.started_at, j.finished_at
FROM conversion_jobs j
JOIN raw_uploads r ON r.id = j.raw_upload_id
ORDER BY j.created_at DESC
LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ConversionJobView, 0)
	for rows.Next() {
		var item ConversionJobView
		if err := rows.Scan(&item.ID, &item.RawUploadID, &item.SourceName, &item.SourceFile,
			&item.SourceFormat, &item.Status, &item.MinZoom, &item.MaxZoom, &item.LayerName, &item.Progress, &item.CurrentStep, &item.EstimatedSeconds,
			&item.CreatedAt, &item.StartedAt, &item.FinishedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ListConversionArtifacts(ctx context.Context, limit int) ([]ConversionArtifactView, error) {
	rows, err := s.pool.Query(ctx, `
SELECT j.id, r.display_name, 'mbtiles', j.min_zoom, j.max_zoom, j.finished_at
FROM conversion_jobs j
JOIN raw_uploads r ON r.id = j.raw_upload_id
WHERE j.status = 'succeeded' AND j.output_object_key IS NOT NULL
ORDER BY j.finished_at DESC
LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ConversionArtifactView, 0)
	for rows.Next() {
		var item ConversionArtifactView
		if err := rows.Scan(&item.ID, &item.SourceName, &item.OutputFormat, &item.MinZoom, &item.MaxZoom, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ConversionArtifact(ctx context.Context, id string) (ConversionArtifact, error) {
	var artifact ConversionArtifact
	err := s.pool.QueryRow(ctx, `
SELECT j.id, r.display_name, 'mbtiles', j.min_zoom, j.max_zoom, j.finished_at, j.output_object_key
FROM conversion_jobs j
JOIN raw_uploads r ON r.id = j.raw_upload_id
WHERE j.id = $1 AND j.status = 'succeeded' AND j.output_object_key IS NOT NULL`, id).Scan(
		&artifact.ID, &artifact.SourceName, &artifact.OutputFormat,
		&artifact.MinZoom, &artifact.MaxZoom, &artifact.CreatedAt, &artifact.OutputObjectKey,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ConversionArtifact{}, ErrConversionJobNotFound
	}
	return artifact, err
}

func (s *Store) CreateRelease(ctx context.Context, release MapRelease, artifactIDs []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err = tx.Exec(ctx, `INSERT INTO map_releases (id,name,slug,description,visibility,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$7)`, release.ID, release.Name, release.Slug, release.Description, release.Visibility, "", release.CreatedAt); err != nil {
		return err
	}
	for _, id := range artifactIDs {
		result, err := tx.Exec(ctx, `INSERT INTO map_release_artifacts (release_id,artifact_id) SELECT $1,id FROM conversion_jobs WHERE id=$2 AND status='succeeded' AND output_object_key IS NOT NULL`, release.ID, id)
		if err != nil {
			return err
		}
		if result.RowsAffected() != 1 {
			return ErrConversionJobNotActive
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) ListReleases(ctx context.Context, limit int) ([]MapRelease, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,name,slug,description,visibility,status,created_at,updated_at,published_at FROM map_releases ORDER BY updated_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []MapRelease{}
	for rows.Next() {
		var item MapRelease
		if err := rows.Scan(&item.ID, &item.Name, &item.Slug, &item.Description, &item.Visibility, &item.Status, &item.CreatedAt, &item.UpdatedAt, &item.PublishedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) StartReleasePublish(ctx context.Context, id string) error {
	result, err := s.pool.Exec(ctx, `UPDATE map_releases SET status='publishing',failure_message=NULL,updated_at=NOW() WHERE id=$1 AND status='draft'`, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrConversionJobNotActive
	}
	return nil
}

func (s *Store) ClaimReleasePublish(ctx context.Context) (*MapRelease, []ReleaseArtifact, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var release MapRelease
	err = tx.QueryRow(ctx, `SELECT id,name,slug,description,visibility,status,created_at,updated_at,published_at FROM map_releases WHERE status='publishing' ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1`).Scan(&release.ID, &release.Name, &release.Slug, &release.Description, &release.Visibility, &release.Status, &release.CreatedAt, &release.UpdatedAt, &release.PublishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, tx.Commit(ctx)
	}
	if err != nil {
		return nil, nil, err
	}
	rows, err := tx.Query(ctx, `SELECT a.release_id,a.artifact_id,r.display_name,j.output_object_key,COALESCE(a.tile_prefix,''),COALESCE(a.tile_format,''),COALESCE(a.min_zoom,j.min_zoom),COALESCE(a.max_zoom,j.max_zoom) FROM map_release_artifacts a JOIN conversion_jobs j ON j.id=a.artifact_id JOIN raw_uploads r ON r.id=j.raw_upload_id WHERE a.release_id=$1`, release.ID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	items := []ReleaseArtifact{}
	for rows.Next() {
		var item ReleaseArtifact
		if err := rows.Scan(&item.ReleaseID, &item.ArtifactID, &item.SourceName, &item.OutputObjectKey, &item.TilePrefix, &item.TileFormat, &item.MinZoom, &item.MaxZoom); err != nil {
			return nil, nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return &release, items, tx.Commit(ctx)
}

func (s *Store) CompleteReleasePublish(ctx context.Context, releaseID string, artifact ReleaseArtifact) error {
	_, err := s.pool.Exec(ctx, `UPDATE map_release_artifacts SET tile_prefix=$3,tile_format=$4,min_zoom=$5,max_zoom=$6 WHERE release_id=$1 AND artifact_id=$2`, releaseID, artifact.ArtifactID, artifact.TilePrefix, artifact.TileFormat, artifact.MinZoom, artifact.MaxZoom)
	return err
}

func (s *Store) FinishReleasePublish(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `UPDATE map_releases SET status='published',published_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='publishing'`, id)
	return err
}
func (s *Store) FailReleasePublish(ctx context.Context, id, message string) error {
	_, err := s.pool.Exec(ctx, `UPDATE map_releases SET status='failed',failure_message=LEFT($2,4000),updated_at=NOW() WHERE id=$1`, id, message)
	return err
}

func (s *Store) PublishedRelease(ctx context.Context, slug string) (MapRelease, []ReleaseArtifact, error) {
	var release MapRelease
	err := s.pool.QueryRow(ctx, `SELECT id,name,slug,description,visibility,status,created_at,updated_at,published_at FROM map_releases WHERE slug=$1 AND status='published'`, slug).Scan(&release.ID, &release.Name, &release.Slug, &release.Description, &release.Visibility, &release.Status, &release.CreatedAt, &release.UpdatedAt, &release.PublishedAt)
	if err != nil {
		return MapRelease{}, nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT a.release_id,a.artifact_id,r.display_name,'',a.tile_prefix,a.tile_format,a.min_zoom,a.max_zoom FROM map_release_artifacts a JOIN conversion_jobs j ON j.id=a.artifact_id JOIN raw_uploads r ON r.id=j.raw_upload_id WHERE a.release_id=$1`, release.ID)
	if err != nil {
		return MapRelease{}, nil, err
	}
	defer rows.Close()
	items := []ReleaseArtifact{}
	for rows.Next() {
		var item ReleaseArtifact
		if err := rows.Scan(&item.ReleaseID, &item.ArtifactID, &item.SourceName, &item.OutputObjectKey, &item.TilePrefix, &item.TileFormat, &item.MinZoom, &item.MaxZoom); err != nil {
			return MapRelease{}, nil, err
		}
		items = append(items, item)
	}
	return release, items, rows.Err()
}

// ClaimConversionJob atomically reserves one queued job. SKIP LOCKED allows
// future replicas to process separate jobs without double conversion.
func (s *Store) ClaimConversionJob(ctx context.Context) (*ConversionJob, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	job := &ConversionJob{}
	err = tx.QueryRow(ctx, `
SELECT j.id, j.raw_upload_id, r.source_file_name, r.source_format, r.raw_object_key, r.byte_size,
       j.status, j.min_zoom, j.max_zoom, COALESCE(j.layer_name, ''), j.created_at
FROM conversion_jobs j
JOIN raw_uploads r ON r.id = j.raw_upload_id
WHERE j.status = 'queued'
ORDER BY j.created_at
FOR UPDATE OF j SKIP LOCKED
LIMIT 1`).Scan(
		&job.ID, &job.RawUploadID, &job.SourceFileName, &job.SourceFormat, &job.RawObjectKey, &job.SourceByteSize,
		&job.Status, &job.MinZoom, &job.MaxZoom, &job.LayerName, &job.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, tx.Commit(ctx)
	}
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	var estimate *int
	if err := tx.QueryRow(ctx, `
SELECT ROUND(AVG(EXTRACT(EPOCH FROM completed.finished_at - completed.started_at)))::INTEGER
FROM conversion_jobs completed
JOIN raw_uploads completed_source ON completed_source.id = completed.raw_upload_id
WHERE completed.status = 'succeeded'
  AND completed.finished_at IS NOT NULL
  AND completed.started_at IS NOT NULL
  AND completed_source.source_format = $1
  AND completed_source.byte_size BETWEEN GREATEST(1, $2 / 2) AND $2 * 2`, job.SourceFormat, job.SourceByteSize).Scan(&estimate); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE conversion_jobs SET status = 'running', progress = 5, current_step = 'downloading', started_at = $2, estimated_duration_seconds = $3 WHERE id = $1`, job.ID, now, estimate); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE raw_uploads SET status = 'converting' WHERE id = $1`, job.RawUploadID); err != nil {
		return nil, err
	}
	job.Status, job.Progress, job.CurrentStep, job.StartedAt, job.EstimatedSeconds = "running", 5, "downloading", &now, estimate
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return job, nil
}

func (s *Store) CompleteConversionJob(ctx context.Context, jobID, outputObjectKey string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var rawUploadID string
	err = tx.QueryRow(ctx, `
UPDATE conversion_jobs
SET status = 'succeeded', progress = 100, current_step = 'succeeded', output_object_key = $2, finished_at = NOW(), failure_message = NULL
WHERE id = $1 AND status = 'running'
RETURNING raw_upload_id`, jobID, outputObjectKey).Scan(&rawUploadID)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE raw_uploads SET status = 'converted' WHERE id = $1`, rawUploadID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) FailConversionJob(ctx context.Context, jobID, message string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var rawUploadID string
	err = tx.QueryRow(ctx, `
UPDATE conversion_jobs
SET status = 'failed', current_step = 'failed', failure_message = LEFT($2, 4000), finished_at = NOW()
WHERE id = $1 AND status = 'running'
RETURNING raw_upload_id`, jobID, message).Scan(&rawUploadID)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE raw_uploads SET status = 'failed' WHERE id = $1`, rawUploadID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CancelConversionJob makes cancellation durable before the worker observes it.
// A running worker polls this state and terminates its child conversion process.
// The source remains available for a later conversion attempt.
func (s *Store) CancelConversionJob(ctx context.Context, jobID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var rawUploadID string
	err = tx.QueryRow(ctx, `
UPDATE conversion_jobs
SET status = 'canceled', current_step = 'canceled', finished_at = NOW()
WHERE id = $1 AND status IN ('queued', 'running')
RETURNING raw_upload_id`, jobID).Scan(&rawUploadID)
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if checkErr := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM conversion_jobs WHERE id = $1)`, jobID).Scan(&exists); checkErr != nil {
			return checkErr
		}
		if !exists {
			return ErrConversionJobNotFound
		}
		return ErrConversionJobNotActive
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
UPDATE raw_uploads
SET status = CASE WHEN EXISTS (
  SELECT 1 FROM conversion_jobs WHERE raw_upload_id = $1 AND status = 'succeeded'
) THEN 'converted' ELSE 'uploaded' END
WHERE id = $1`, rawUploadID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// IsConversionJobCanceled lets a worker stop a long-running local tool without
// exposing worker controls or S3 credentials through the browser API.
func (s *Store) IsConversionJobCanceled(ctx context.Context, jobID string) (bool, error) {
	var status string
	err := s.pool.QueryRow(ctx, `SELECT status FROM conversion_jobs WHERE id = $1`, jobID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrConversionJobNotFound
	}
	return status == "canceled", err
}

// ConversionJobOutputKeyForDeletion returns an internal artifact key only to the
// API process. It is never serialized to the browser.
func (s *Store) ConversionJobOutputKeyForDeletion(ctx context.Context, jobID string) (string, error) {
	var status, outputObjectKey string
	err := s.pool.QueryRow(ctx, `
SELECT status, COALESCE(output_object_key, '')
FROM conversion_jobs WHERE id = $1`, jobID).Scan(&status, &outputObjectKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrConversionJobNotFound
	}
	if err != nil {
		return "", err
	}
	if status != "succeeded" && status != "failed" && status != "canceled" {
		return "", ErrConversionJobNotRemovable
	}
	return outputObjectKey, nil
}

// DeleteConversionJob removes a terminal task after the caller has removed
// any derived artifact returned by ConversionJobOutputKeyForDeletion.
func (s *Store) DeleteConversionJob(ctx context.Context, jobID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var rawUploadID string
	err = tx.QueryRow(ctx, `
DELETE FROM conversion_jobs
WHERE id = $1 AND status IN ('succeeded', 'failed', 'canceled')
RETURNING raw_upload_id`, jobID).Scan(&rawUploadID)
	if err == nil {
		if _, err := tx.Exec(ctx, `
UPDATE raw_uploads
SET status = CASE WHEN EXISTS (
  SELECT 1 FROM conversion_jobs WHERE raw_upload_id = $1 AND status = 'succeeded'
) THEN 'converted' ELSE 'uploaded' END
WHERE id = $1`, rawUploadID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM conversion_jobs WHERE id = $1)`, jobID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrConversionJobNotFound
	}
	return ErrConversionJobNotRemovable
}

// UpdateConversionProgress accepts only predefined workflow steps controlled by
// the worker; arbitrary diagnostic text never reaches the user interface.
func (s *Store) UpdateConversionProgress(ctx context.Context, jobID string, progress int, step string) error {
	if progress < 0 || progress > 100 {
		return errors.New("conversion progress must be between 0 and 100")
	}
	switch step {
	case "downloading", "converting", "publishing":
	default:
		return errors.New("invalid conversion step")
	}
	_, err := s.pool.Exec(ctx, `
UPDATE conversion_jobs
SET progress = GREATEST(progress, $2), current_step = $3
WHERE id = $1 AND status = 'running'`, jobID, progress, step)
	return err
}
