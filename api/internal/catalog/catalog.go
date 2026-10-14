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

var ErrRawUploadNotFound = errors.New("raw upload not found")

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
	ID              string
	RawUploadID     string
	SourceFileName  string
	SourceFormat    string
	RawObjectKey    string
	Status          string
	MinZoom         int
	MaxZoom         int
	LayerName       string
	OutputObjectKey string
	FailureMessage  string
	CreatedAt       time.Time
	StartedAt       *time.Time
	FinishedAt      *time.Time
}

type JobCounts struct {
	Queued  int
	Running int
	Failed  int
}

// ConversionJobView is safe for the user interface. It contains catalog names
// and progress state, never S3 keys, credentials, or worker diagnostics.
type ConversionJobView struct {
	ID           string     `json:"id"`
	RawUploadID  string     `json:"rawUploadId"`
	SourceName   string     `json:"sourceName"`
	SourceFile   string     `json:"sourceFileName"`
	SourceFormat string     `json:"sourceFormat"`
	Status       string     `json:"status"`
	MinZoom      int        `json:"minZoom"`
	MaxZoom      int        `json:"maxZoom"`
	LayerName    string     `json:"layerName,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	StartedAt    *time.Time `json:"startedAt"`
	FinishedAt   *time.Time `json:"finishedAt"`
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
	var job ConversionJob
	err := s.pool.QueryRow(ctx, `
INSERT INTO conversion_jobs (id, raw_upload_id, min_zoom, max_zoom, layer_name)
SELECT $1, id, $3, $4, NULLIF($5, '')
FROM raw_uploads
WHERE id = $2 AND status IN ('uploaded', 'failed', 'converted')
RETURNING id, raw_upload_id, status, min_zoom, max_zoom, COALESCE(layer_name, ''), created_at`,
		id, rawUploadID, minZoom, maxZoom, layerName,
	).Scan(&job.ID, &job.RawUploadID, &job.Status, &job.MinZoom, &job.MaxZoom, &job.LayerName, &job.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return ConversionJob{}, ErrRawUploadNotFound
	}
	return job, err
}

func (s *Store) ListConversionJobs(ctx context.Context, limit int) ([]ConversionJobView, error) {
	rows, err := s.pool.Query(ctx, `
SELECT j.id, j.raw_upload_id, r.display_name, r.source_file_name, r.source_format,
       j.status, j.min_zoom, j.max_zoom, COALESCE(j.layer_name, ''), j.created_at,
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
			&item.SourceFormat, &item.Status, &item.MinZoom, &item.MaxZoom, &item.LayerName,
			&item.CreatedAt, &item.StartedAt, &item.FinishedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
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
SELECT j.id, j.raw_upload_id, r.source_file_name, r.source_format, r.raw_object_key,
       j.status, j.min_zoom, j.max_zoom, COALESCE(j.layer_name, ''), j.created_at
FROM conversion_jobs j
JOIN raw_uploads r ON r.id = j.raw_upload_id
WHERE j.status = 'queued'
ORDER BY j.created_at
FOR UPDATE OF j SKIP LOCKED
LIMIT 1`).Scan(
		&job.ID, &job.RawUploadID, &job.SourceFileName, &job.SourceFormat, &job.RawObjectKey,
		&job.Status, &job.MinZoom, &job.MaxZoom, &job.LayerName, &job.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, tx.Commit(ctx)
	}
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if _, err := tx.Exec(ctx, `UPDATE conversion_jobs SET status = 'running', started_at = $2 WHERE id = $1`, job.ID, now); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE raw_uploads SET status = 'converting' WHERE id = $1`, job.RawUploadID); err != nil {
		return nil, err
	}
	job.Status, job.StartedAt = "running", &now
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
SET status = 'succeeded', output_object_key = $2, finished_at = NOW(), failure_message = NULL
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
SET status = 'failed', failure_message = LEFT($2, 4000), finished_at = NOW()
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
