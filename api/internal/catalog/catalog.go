package catalog

import (
	"context"
	"embed"
	"encoding/json"
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
	ID              string
	RawUploadID     string
	SourceFileName  string
	SourceFormat    string
	RawObjectKey    string
	Status          string
	MinZoom         int
	MaxZoom         int
	LayerName       string
	SourceByteSize  int64
	Progress        int
	CurrentStep     string
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
	Progress     int        `json:"progress"`
	CurrentStep  string     `json:"currentStep"`
	CreatedAt    time.Time  `json:"createdAt"`
	StartedAt    *time.Time `json:"startedAt"`
	FinishedAt   *time.Time `json:"finishedAt"`
}

// ConversionArtifactView is the safe, browser-facing metadata for a successful
// MBTiles conversion. CacheStatus makes the hand-off to the GeoData tile store
// observable without exposing an object key or a storage implementation detail.
type ConversionArtifactView struct {
	ID           string    `json:"id"`
	SourceName   string    `json:"sourceName"`
	OutputFormat string    `json:"outputFormat"`
	CacheStatus  string    `json:"cacheStatus"`
	MinZoom      int       `json:"minZoom"`
	MaxZoom      int       `json:"maxZoom"`
	CreatedAt    time.Time `json:"createdAt"`
}

type ConversionArtifact struct {
	ConversionArtifactView
	OutputObjectKey, TileServerDataset string
	TileFormat                         string
	Bounds, VectorLayers               json.RawMessage
}

// CacheArtifact is an internal materialization work item. Object keys remain
// private: only the GeoData tile-store worker receives them.
type CacheArtifact struct {
	ID, OutputObjectKey, DataType, SourceFormat string
}

type MapRelease struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	MapCode        string     `json:"mapCode"`
	Version        string     `json:"version"`
	Slug           string     `json:"slug"`
	Description    string     `json:"description"`
	ReleaseNotes   string     `json:"releaseNotes"`
	Visibility     string     `json:"visibility"`
	Status         string     `json:"status"`
	CreatedBy      string     `json:"-"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	PublishedAt    *time.Time `json:"publishedAt"`
	ArtifactIDs    []string   `json:"artifactIds"`
	StyleVersionID string     `json:"styleVersionId,omitempty"`
}

// StyleVersion is a server-owned, immutable MapLibre style. The document and
// auxiliary assets must only be served through the authenticated tile gateway.
type StyleVersion struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Document  json.RawMessage `json:"document,omitempty"`
	HasSprite bool            `json:"hasSprite"`
	HasGlyphs bool            `json:"hasGlyphs"`
	CreatedAt time.Time       `json:"createdAt"`
}

// AccessGrant references an identity owned by WebGIS. The catalog never
// persists user profile data; SubjectName and Organization are populated by
// the API from the read-only WebGIS directory.
type AccessGrant struct {
	ID            string     `json:"id"`
	PrincipalType string     `json:"principalType"`
	PrincipalID   string     `json:"principalId"`
	SubjectName   string     `json:"subjectName,omitempty"`
	Organization  string     `json:"organization,omitempty"`
	ReleaseID     string     `json:"releaseId"`
	ReleaseName   string     `json:"releaseName"`
	Scope         string     `json:"scope"`
	Note          string     `json:"note,omitempty"`
	Status        string     `json:"status"`
	CreatedBy     string     `json:"-"`
	CreatedAt     time.Time  `json:"createdAt"`
	RevokedAt     *time.Time `json:"revokedAt,omitempty"`
}

var ErrAccessGrantNotFound = errors.New("access grant not found")

type ReleaseArtifact struct {
	ReleaseID, ArtifactID, SourceName, OutputObjectKey string
	TilePrefix, TileFormat                             string
	ServingBackend, TileServerDataset, WarmStatus      string
	MinZoom, MaxZoom                                   int
	Bounds, VectorLayers                               json.RawMessage
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

// CreateImportedMBTiles registers an already-built MBTiles file as a finished
// artifact. It retains the uploaded source record for traceability, but never
// places a conversion task in the worker queue. The serving-store warmer is
// responsible only for validating and materializing the immutable artifact.
func (s *Store) CreateImportedMBTiles(ctx context.Context, source NewRawUpload, artifactID, outputObjectKey string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err = tx.Exec(ctx, `
INSERT INTO raw_uploads (
  id, display_name, data_type, source_file_name, source_format, raw_object_key,
  byte_size, sha256, status, created_by, created_at
) VALUES ($1, $2, $3, $4, 'mbtiles', $5, $6, $7, 'converted', NULLIF($8, ''), $9)`,
		source.ID, source.Name, source.DataType, source.FileName, source.ObjectKey,
		source.ByteSize, source.SHA256, source.CreatedBy, source.CreatedAt); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
INSERT INTO conversion_jobs (
  id, raw_upload_id, status, min_zoom, max_zoom, output_object_key,
  created_at, started_at, finished_at, progress, current_step,
  tile_cache_status, tile_serving_backend
) VALUES ($1, $2, 'succeeded', 0, 24, $3, $4, $4, $4, 100, 'succeeded', 'pending', 'geodata_mbtiles')`,
		artifactID, source.ID, outputObjectKey, source.CreatedAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
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
	       j.status, j.min_zoom, j.max_zoom, COALESCE(j.layer_name, ''), j.progress, j.current_step, j.created_at,
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
			&item.SourceFormat, &item.Status, &item.MinZoom, &item.MaxZoom, &item.LayerName, &item.Progress, &item.CurrentStep,
			&item.CreatedAt, &item.StartedAt, &item.FinishedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ListConversionArtifacts(ctx context.Context, limit int) ([]ConversionArtifactView, error) {
	rows, err := s.pool.Query(ctx, `
	SELECT j.id, r.display_name, 'mbtiles', COALESCE(j.tile_cache_status,'pending'), j.min_zoom, j.max_zoom, j.finished_at
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
		if err := rows.Scan(&item.ID, &item.SourceName, &item.OutputFormat, &item.CacheStatus, &item.MinZoom, &item.MaxZoom, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ConversionArtifact(ctx context.Context, id string) (ConversionArtifact, error) {
	var artifact ConversionArtifact
	err := s.pool.QueryRow(ctx, `
SELECT j.id, r.display_name, 'mbtiles', COALESCE(j.tile_cache_status,'pending'), j.min_zoom, j.max_zoom, j.finished_at, j.output_object_key,
       COALESCE(j.tile_server_dataset,''), COALESCE(j.tile_format,''), COALESCE(j.tile_bounds::text,'[]'), COALESCE(j.tile_vector_layers::text,'[]')
FROM conversion_jobs j
JOIN raw_uploads r ON r.id = j.raw_upload_id
WHERE j.id = $1 AND j.status = 'succeeded' AND j.output_object_key IS NOT NULL`, id).Scan(
		&artifact.ID, &artifact.SourceName, &artifact.OutputFormat, &artifact.CacheStatus,
		&artifact.MinZoom, &artifact.MaxZoom, &artifact.CreatedAt, &artifact.OutputObjectKey,
		&artifact.TileServerDataset, &artifact.TileFormat, &artifact.Bounds, &artifact.VectorLayers,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ConversionArtifact{}, ErrConversionJobNotFound
	}
	return artifact, err
}

// ClaimCacheArtifact reserves one converted MBTiles artifact for materializing
// in GeoData's local serving volume. A separate cache status keeps this slow
// I/O out of release publication.
func (s *Store) ClaimCacheArtifact(ctx context.Context, servingBackend string) (*CacheArtifact, error) {
	if servingBackend != "tileserver_cache" && servingBackend != "geodata_mbtiles" {
		return nil, errors.New("invalid tile serving backend")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	artifact := &CacheArtifact{}
	err = tx.QueryRow(ctx, `
SELECT j.id, j.output_object_key, r.data_type, r.source_format
FROM conversion_jobs j
JOIN raw_uploads r ON r.id = j.raw_upload_id
WHERE j.status='succeeded' AND j.output_object_key IS NOT NULL
	AND COALESCE(j.tile_serving_backend, 'tileserver_cache')=$1
  AND (
	 j.tile_cache_status='pending' OR
	 (j.tile_cache_status='failed' AND COALESCE(j.tile_cache_last_attempt_at, TO_TIMESTAMP(0)) < NOW() - INTERVAL '5 minutes')
  )
ORDER BY CASE j.tile_cache_status WHEN 'pending' THEN 0 ELSE 1 END, j.finished_at NULLS LAST, j.created_at
FOR UPDATE SKIP LOCKED
LIMIT 1`, servingBackend).Scan(&artifact.ID, &artifact.OutputObjectKey, &artifact.DataType, &artifact.SourceFormat)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, tx.Commit(ctx)
	}
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE conversion_jobs SET tile_cache_status='warming',tile_cache_failure=NULL,tile_cache_attempts=tile_cache_attempts+1,tile_cache_last_attempt_at=NOW() WHERE id=$1`, artifact.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return artifact, nil
}

func (s *Store) CompleteArtifactCache(ctx context.Context, artifact CacheArtifact, tile ReleaseArtifact, servingBackend string) error {
	if servingBackend != "tileserver_cache" && servingBackend != "geodata_mbtiles" {
		return errors.New("invalid tile serving backend")
	}
	_, err := s.pool.Exec(ctx, `
UPDATE conversion_jobs
SET tile_cache_status='ready', tile_serving_backend=$2, tile_server_dataset=$3, tile_format=$4,
    tile_bounds=$5::jsonb, tile_vector_layers=$6::jsonb, min_zoom=$7, max_zoom=$8,
    tile_cache_warmed_at=NOW(), tile_cache_failure=NULL
WHERE id=$1 AND status='succeeded' AND tile_cache_status='warming'`, artifact.ID, servingBackend, tile.TileServerDataset, tile.TileFormat, defaultJSON(tile.Bounds, "[-180,-85.051129,180,85.051129]"), defaultJSON(tile.VectorLayers, "[]"), tile.MinZoom, tile.MaxZoom)
	return err
}

func (s *Store) FailArtifactCache(ctx context.Context, artifactID, message string) error {
	_, err := s.pool.Exec(ctx, `UPDATE conversion_jobs SET tile_cache_status='failed',tile_cache_failure=LEFT($2,4000) WHERE id=$1 AND tile_cache_status='warming'`, artifactID, message)
	return err
}

func (s *Store) CreateRelease(ctx context.Context, release MapRelease, artifactIDs []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err = tx.Exec(ctx, `INSERT INTO map_releases (id,name,map_code,version,slug,description,release_notes,visibility,style_version_id,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,'')::uuid,NULLIF($10,''),$11,$11)`, release.ID, release.Name, release.MapCode, release.Version, release.Slug, release.Description, release.ReleaseNotes, release.Visibility, release.StyleVersionID, release.CreatedBy, release.CreatedAt); err != nil {
		return err
	}
	for _, id := range artifactIDs {
		result, err := tx.Exec(ctx, `
INSERT INTO map_release_artifacts (release_id,artifact_id,serving_backend,tile_server_dataset,warm_status,warmed_at,tile_format,bounds,min_zoom,max_zoom,vector_layers)
SELECT $1,id,'geodata_mbtiles',NULL,'ready',tile_cache_warmed_at,tile_format,tile_bounds,min_zoom,max_zoom,tile_vector_layers
FROM conversion_jobs
WHERE id=$2 AND status='succeeded' AND output_object_key IS NOT NULL
  AND tile_cache_status='ready' AND tile_serving_backend='geodata_mbtiles'`, release.ID, id)
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
	rows, err := s.pool.Query(ctx, `SELECT id,name,map_code,version,slug,description,release_notes,visibility,status,created_at,updated_at,published_at,COALESCE(style_version_id::text,'') FROM map_releases ORDER BY updated_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []MapRelease{}
	for rows.Next() {
		var item MapRelease
		if err := rows.Scan(&item.ID, &item.Name, &item.MapCode, &item.Version, &item.Slug, &item.Description, &item.ReleaseNotes, &item.Visibility, &item.Status, &item.CreatedAt, &item.UpdatedAt, &item.PublishedAt, &item.StyleVersionID); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := s.populateReleaseArtifactIDs(ctx, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Store) CreateStyleVersion(ctx context.Context, style StyleVersion, createdBy string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO style_versions (id,name,document,has_sprite,has_glyphs,created_by,created_at) VALUES ($1,$2,$3::jsonb,$4,$5,NULLIF($6,''),$7)`, style.ID, style.Name, string(style.Document), style.HasSprite, style.HasGlyphs, createdBy, style.CreatedAt)
	return err
}

func (s *Store) ListStyleVersions(ctx context.Context, limit int) ([]StyleVersion, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text,name,has_sprite,has_glyphs,created_at FROM style_versions ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []StyleVersion{}
	for rows.Next() {
		var item StyleVersion
		if err := rows.Scan(&item.ID, &item.Name, &item.HasSprite, &item.HasGlyphs, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// StyleForRelease returns the immutable document selected for a published
// release. A nil result means this legacy release uses the automatic preview
// style and not an error.
func (s *Store) StyleForRelease(ctx context.Context, releaseID string) (*StyleVersion, error) {
	var item StyleVersion
	err := s.pool.QueryRow(ctx, `SELECT s.id::text,s.name,s.document::text,s.has_sprite,s.has_glyphs,s.created_at FROM map_releases r JOIN style_versions s ON s.id=r.style_version_id WHERE r.id=$1`, releaseID).Scan(&item.ID, &item.Name, &item.Document, &item.HasSprite, &item.HasGlyphs, &item.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (s *Store) populateReleaseArtifactIDs(ctx context.Context, releases []MapRelease) error {
	if len(releases) == 0 {
		return nil
	}
	ids := make([]string, 0, len(releases))
	for _, release := range releases {
		ids = append(ids, release.ID)
	}
	rows, err := s.pool.Query(ctx, `SELECT release_id::text, artifact_id::text FROM map_release_artifacts WHERE release_id::text = ANY($1::text[])`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	byRelease := make(map[string][]string, len(releases))
	for rows.Next() {
		var releaseID, artifactID string
		if err := rows.Scan(&releaseID, &artifactID); err != nil {
			return err
		}
		byRelease[releaseID] = append(byRelease[releaseID], artifactID)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for index := range releases {
		releases[index].ArtifactIDs = byRelease[releases[index].ID]
	}
	return nil
}

func (s *Store) MapCodeExists(ctx context.Context, mapCode string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM map_releases WHERE map_code=$1)`, mapCode).Scan(&exists)
	return exists, err
}

func (s *Store) StartReleasePublish(ctx context.Context, id string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Lock the release first. Besides eliminating a race between two browser
	// clicks, this makes publishing idempotent: a retry after the first request
	// has started or completed is safe and lets the UI reload the true state.
	var currentStatus string
	err = tx.QueryRow(ctx, `SELECT status FROM map_releases WHERE id=$1 FOR UPDATE`, id).Scan(&currentStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrConversionJobNotFound
	}
	if err != nil {
		return err
	}
	switch currentStatus {
	case "published", "publishing":
		return tx.Commit(ctx)
	case "draft":
		// Continue below.
	default:
		return ErrConversionJobNotActive
	}
	// Newly-created drafts only reference MBTiles already present on GeoData's
	// serving volume, so publication is a metadata transition. Preserve the
	// asynchronous path for drafts created before cache readiness existed.
	var cacheReady bool
	err = tx.QueryRow(ctx, `
SELECT COALESCE(bool_and(serving_backend='geodata_mbtiles' AND warm_status='ready'), false)
FROM map_release_artifacts
WHERE release_id=$1`, id).Scan(&cacheReady)
	if err != nil {
		return err
	}
	status := "publishing"
	if cacheReady {
		status = "published"
	}
	result, err := tx.Exec(ctx, `
UPDATE map_releases
SET status=$2::VARCHAR(32),
    published_at=CASE WHEN $2::VARCHAR(32)='published' THEN NOW() ELSE NULL END,
    failure_message=NULL,
    updated_at=NOW()
WHERE id=$1 AND status='draft'`, id, status)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrConversionJobNotActive
	}
	return tx.Commit(ctx)
}

// UnpublishRelease immediately removes a release from the tile gateway by
// changing it to archived. Published tile objects are retained for safe audit
// and can be cleaned by a separate retention job.
func (s *Store) UnpublishRelease(ctx context.Context, id string) error {
	result, err := s.pool.Exec(ctx, `UPDATE map_releases SET status='archived',updated_at=NOW() WHERE id=$1 AND status='published'`, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrConversionJobNotActive
	}
	return nil
}

// DeleteRelease removes a release catalog entry only when it cannot be served.
// Raw uploads and derived MBTiles are immutable source artifacts and are never
// deleted as a consequence of deleting a release.
func (s *Store) DeleteRelease(ctx context.Context, id string) error {
	result, err := s.pool.Exec(ctx, `DELETE FROM map_releases WHERE id=$1 AND status IN ('draft','failed','archived')`, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrConversionJobNotActive
	}
	return nil
}

func (s *Store) CreateAccessGrant(ctx context.Context, grant AccessGrant) (AccessGrant, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AccessGrant{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if grant.PrincipalType == "public" {
		grant.PrincipalID = "*"
		grant.Scope = "view"
		if _, err = tx.Exec(ctx, `UPDATE access_grants SET status='revoked',revoked_at=NOW(),revoked_by=NULLIF($2,'') WHERE release_id=$1 AND status='active' AND principal_type <> 'public'`, grant.ReleaseID, grant.CreatedBy); err != nil {
			return AccessGrant{}, err
		}
		if _, err = tx.Exec(ctx, `UPDATE map_releases SET visibility='public',updated_at=NOW() WHERE id=$1`, grant.ReleaseID); err != nil {
			return AccessGrant{}, err
		}
	} else {
		// A named-recipient policy replaces a previous public policy. Multiple
		// named grants remain active together.
		if _, err = tx.Exec(ctx, `UPDATE access_grants SET status='revoked',revoked_at=NOW(),revoked_by=NULLIF($2,'') WHERE release_id=$1 AND status='active' AND principal_type='public'`, grant.ReleaseID, grant.CreatedBy); err != nil {
			return AccessGrant{}, err
		}
		if _, err = tx.Exec(ctx, `UPDATE map_releases SET visibility='restricted',updated_at=NOW() WHERE id=$1`, grant.ReleaseID); err != nil {
			return AccessGrant{}, err
		}
	}
	err = tx.QueryRow(ctx, `
INSERT INTO access_grants (principal_type,principal_id,release_id,scope,note,created_by)
SELECT $1,$2,id,$3,$4,NULLIF($5,'') FROM map_releases WHERE id=$6
ON CONFLICT DO NOTHING
RETURNING id,principal_type,principal_id,release_id,scope,note,status,created_by,created_at,revoked_at`,
		grant.PrincipalType, grant.PrincipalID, grant.Scope, grant.Note, grant.CreatedBy, grant.ReleaseID,
	).Scan(&grant.ID, &grant.PrincipalType, &grant.PrincipalID, &grant.ReleaseID, &grant.Scope, &grant.Note, &grant.Status, &grant.CreatedBy, &grant.CreatedAt, &grant.RevokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return AccessGrant{}, ErrAccessGrantNotFound
	}
	if err != nil {
		return AccessGrant{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO access_audit_events(action,grant_id,actor_id) VALUES ('grant_created',$1,NULLIF($2,''))`, grant.ID, grant.CreatedBy); err != nil {
		return AccessGrant{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return AccessGrant{}, err
	}
	return grant, nil
}

func (s *Store) ListAccessGrants(ctx context.Context, principalType string, limit int) ([]AccessGrant, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
SELECT g.id,g.principal_type,g.principal_id,g.release_id,r.name,g.scope,g.note,g.status,g.created_by,g.created_at,g.revoked_at
FROM access_grants g JOIN map_releases r ON r.id=g.release_id
WHERE ($1='' OR g.principal_type=$1)
ORDER BY g.created_at DESC LIMIT $2`, principalType, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AccessGrant, 0)
	for rows.Next() {
		var item AccessGrant
		if err := rows.Scan(&item.ID, &item.PrincipalType, &item.PrincipalID, &item.ReleaseID, &item.ReleaseName, &item.Scope, &item.Note, &item.Status, &item.CreatedBy, &item.CreatedAt, &item.RevokedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) RevokeAccessGrant(ctx context.Context, id, actorID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var releaseID, principalType string
	err = tx.QueryRow(ctx, `
UPDATE access_grants SET status='revoked',revoked_at=NOW(),revoked_by=NULLIF($2,'')
WHERE id=$1 AND status='active'
RETURNING release_id,principal_type`, id, actorID).Scan(&releaseID, &principalType)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrAccessGrantNotFound
	}
	if err != nil {
		return err
	}
	if principalType == "public" {
		if _, err = tx.Exec(ctx, `UPDATE map_releases SET visibility='restricted',updated_at=NOW() WHERE id=$1`, releaseID); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO access_audit_events(action,grant_id,actor_id) VALUES ('grant_revoked',$1,NULLIF($2,''))`, id, actorID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CanViewRelease is used by the tile gateway after a verified WebGIS JWT has
// identified the caller. An export grant also includes view permission.
func (s *Store) CanViewRelease(ctx context.Context, releaseID, userID, organization string) (bool, error) {
	var allowed bool
	err := s.pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM access_grants
  WHERE release_id=$1 AND status='active' AND (
    (principal_type='user' AND principal_id=$2) OR
    (principal_type='organization' AND $3<>'' AND lower(principal_id)=lower($3))
  )
)`, releaseID, userID, organization).Scan(&allowed)
	return allowed, err
}

func (s *Store) ClaimReleasePublish(ctx context.Context) (*MapRelease, []ReleaseArtifact, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var release MapRelease
	err = tx.QueryRow(ctx, `SELECT id,name,map_code,version,slug,description,release_notes,visibility,status,created_at,updated_at,published_at,COALESCE(style_version_id::text,'') FROM map_releases WHERE status='publishing' ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1`).Scan(&release.ID, &release.Name, &release.MapCode, &release.Version, &release.Slug, &release.Description, &release.ReleaseNotes, &release.Visibility, &release.Status, &release.CreatedAt, &release.UpdatedAt, &release.PublishedAt, &release.StyleVersionID)
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
	_, err := s.pool.Exec(ctx, `
UPDATE map_release_artifacts
SET serving_backend='tileserver_cache', tile_server_dataset=$3, warm_status='ready', warmed_at=NOW(),
    tile_prefix=NULL, tile_format=$4, min_zoom=$5, max_zoom=$6, bounds=$7::jsonb, vector_layers=$8::jsonb
WHERE release_id=$1 AND artifact_id=$2`, releaseID, artifact.ArtifactID, artifact.TileServerDataset, artifact.TileFormat, artifact.MinZoom, artifact.MaxZoom, defaultJSON(artifact.Bounds, "[-180,-85.051129,180,85.051129]"), defaultJSON(artifact.VectorLayers, "[]"))
	return err
}

func (s *Store) FinishReleasePublish(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `UPDATE map_releases SET status='published',published_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='publishing'`, id)
	return err
}
func (s *Store) FailReleasePublish(ctx context.Context, id, message string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `UPDATE map_releases SET status='failed',failure_message=LEFT($2,4000),updated_at=NOW() WHERE id=$1`, id, message); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE map_release_artifacts SET warm_status='failed' WHERE release_id=$1 AND warm_status='pending'`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) PublishedRelease(ctx context.Context, slug string) (MapRelease, []ReleaseArtifact, error) {
	var release MapRelease
	err := s.pool.QueryRow(ctx, `SELECT id,name,map_code,version,slug,description,release_notes,visibility,status,created_at,updated_at,published_at,COALESCE(style_version_id::text,'') FROM map_releases WHERE slug=$1 AND status='published'`, slug).Scan(&release.ID, &release.Name, &release.MapCode, &release.Version, &release.Slug, &release.Description, &release.ReleaseNotes, &release.Visibility, &release.Status, &release.CreatedAt, &release.UpdatedAt, &release.PublishedAt, &release.StyleVersionID)
	if err != nil {
		return MapRelease{}, nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT a.release_id,a.artifact_id,r.display_name,'',COALESCE(a.tile_prefix,''),COALESCE(a.tile_format,''),COALESCE(a.serving_backend,'object_store'),COALESCE(a.tile_server_dataset,''),COALESCE(a.warm_status,'not_required'),a.min_zoom,a.max_zoom,COALESCE(a.bounds::text,'[-180,-85.051129,180,85.051129]'),COALESCE(a.vector_layers::text,'[]') FROM map_release_artifacts a JOIN conversion_jobs j ON j.id=a.artifact_id JOIN raw_uploads r ON r.id=j.raw_upload_id WHERE a.release_id=$1`, release.ID)
	if err != nil {
		return MapRelease{}, nil, err
	}
	defer rows.Close()
	items := []ReleaseArtifact{}
	for rows.Next() {
		var item ReleaseArtifact
		var bounds, vectorLayers string
		if err := rows.Scan(&item.ReleaseID, &item.ArtifactID, &item.SourceName, &item.OutputObjectKey, &item.TilePrefix, &item.TileFormat, &item.ServingBackend, &item.TileServerDataset, &item.WarmStatus, &item.MinZoom, &item.MaxZoom, &bounds, &vectorLayers); err != nil {
			return MapRelease{}, nil, err
		}
		item.Bounds, item.VectorLayers = json.RawMessage(bounds), json.RawMessage(vectorLayers)
		items = append(items, item)
	}
	return release, items, rows.Err()
}

func defaultJSON(value json.RawMessage, fallback string) string {
	if len(value) == 0 || !json.Valid(value) {
		return fallback
	}
	return string(value)
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
	if _, err := tx.Exec(ctx, `UPDATE conversion_jobs SET status = 'running', progress = 5, current_step = 'downloading', started_at = $2 WHERE id = $1`, job.ID, now); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE raw_uploads SET status = 'converting' WHERE id = $1`, job.RawUploadID); err != nil {
		return nil, err
	}
	job.Status, job.Progress, job.CurrentStep, job.StartedAt = "running", 5, "downloading", &now
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
