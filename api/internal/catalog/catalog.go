package catalog

import (
	"context"
	_ "embed"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/001_raw_uploads.sql
var initialMigration string

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
	_, err := s.pool.Exec(ctx, initialMigration)
	return err
}

func (s *Store) Health(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) CountRawUploads(ctx context.Context) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM raw_uploads").Scan(&count)
	return count, err
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
