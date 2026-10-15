// Package mbtiles reads locally cached MBTiles artifacts. It never accepts an
// object-store URL: S3 access stays in the gateway layer.
package mbtiles

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

var ErrTileNotFound = errors.New("tile not found")

type Bounds struct {
	West  float64 `json:"-"`
	South float64 `json:"-"`
	East  float64 `json:"-"`
	North float64 `json:"-"`
}

func (b Bounds) Values() []float64 { return []float64{b.West, b.South, b.East, b.North} }

type VectorLayer struct {
	ID     string         `json:"id"`
	Fields map[string]any `json:"fields,omitempty"`
}

type Metadata struct {
	Format       string
	MinZoom      int
	MaxZoom      int
	Bounds       Bounds
	VectorLayers []VectorLayer
}

// EnsureServingRole adds the TileServer role used by the existing WebGIS
// catalog only when an MBTiles producer did not set one itself. It operates on
// the local cache copy, never on the immutable object stored in S3.
func EnsureServingRole(ctx context.Context, path, role string) error {
	if role != "baselayer" && role != "overlay" {
		return fmt.Errorf("unsupported TileServer role %q", role)
	}
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT)`); err != nil {
		return fmt.Errorf("create MBTiles metadata table: %w", err)
	}
	var current string
	err = db.QueryRowContext(ctx, `SELECT value FROM metadata WHERE lower(name) = 'type' LIMIT 1`).Scan(&current)
	if err == nil && strings.TrimSpace(current) != "" {
		return nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("read MBTiles serving role: %w", err)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM metadata WHERE lower(name) = 'type'`); err != nil {
		return fmt.Errorf("clear empty MBTiles serving role: %w", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO metadata(name, value) VALUES ('type', ?)`, role); err != nil {
		return fmt.Errorf("set MBTiles serving role: %w", err)
	}
	return nil
}

func open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

// ReadMetadata reads portable MBTiles metadata with safe world-wide defaults
// for producers that omit optional values.
func ReadMetadata(ctx context.Context, path string) (Metadata, error) {
	db, err := open(path)
	if err != nil {
		return Metadata{}, err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, `SELECT name, value FROM metadata`)
	if err != nil {
		return Metadata{}, fmt.Errorf("read MBTiles metadata: %w", err)
	}
	defer rows.Close()
	values := map[string]string{}
	for rows.Next() {
		var name, value string
		if err := rows.Scan(&name, &value); err != nil {
			return Metadata{}, err
		}
		values[strings.ToLower(name)] = value
	}
	if err := rows.Err(); err != nil {
		return Metadata{}, err
	}
	metadata := Metadata{Format: strings.ToLower(values["format"]), Bounds: Bounds{-180, -85.051129, 180, 85.051129}}
	if metadata.Format == "" {
		metadata.Format = "pbf"
	}
	metadata.MinZoom = parseZoom(values["minzoom"], 0)
	metadata.MaxZoom = parseZoom(values["maxzoom"], 14)
	if metadata.MaxZoom < metadata.MinZoom {
		metadata.MaxZoom = metadata.MinZoom
	}
	if bounds, ok := parseBounds(values["bounds"]); ok {
		metadata.Bounds = bounds
	}
	metadata.VectorLayers = parseVectorLayers(values["json"])
	return metadata, nil
}

func ReadTile(ctx context.Context, path string, z, x, y int) ([]byte, error) {
	db, err := open(path)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if z < 0 || z > 30 || x < 0 || y < 0 || x >= 1<<z || y >= 1<<z {
		return nil, ErrTileNotFound
	}
	var data []byte
	tmsY := (1 << z) - 1 - y
	err = db.QueryRowContext(ctx, `
SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?`, z, x, tmsY).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrTileNotFound
	}
	return data, err
}

func parseZoom(raw string, fallback int) int {
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 || value > 24 {
		return fallback
	}
	return value
}

func parseBounds(raw string) (Bounds, bool) {
	parts := strings.Split(raw, ",")
	if len(parts) != 4 {
		return Bounds{}, false
	}
	values := [4]float64{}
	for index, part := range parts {
		value, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
		if err != nil {
			return Bounds{}, false
		}
		values[index] = value
	}
	if values[0] >= values[2] || values[1] >= values[3] {
		return Bounds{}, false
	}
	return Bounds{values[0], values[1], values[2], values[3]}, true
}

func parseVectorLayers(raw string) []VectorLayer {
	// TileJSON clients only need id/fields. Parsing is intentionally best-effort:
	// raster MBTiles and older generators often do not have this metadata.
	var document struct {
		VectorLayers []VectorLayer `json:"vector_layers"`
	}
	if err := json.Unmarshal([]byte(raw), &document); err != nil {
		return nil
	}
	return document.VectorLayers
}
