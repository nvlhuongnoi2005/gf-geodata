package mbtiles

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestEnsureServingRoleSetsMissingRole(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.mbtiles")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE metadata (name TEXT, value TEXT)`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if err := EnsureServingRole(context.Background(), path, "overlay"); err != nil {
		t.Fatal(err)
	}
	db, err = sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var role string
	if err := db.QueryRow(`SELECT value FROM metadata WHERE name = 'type'`).Scan(&role); err != nil {
		t.Fatal(err)
	}
	if role != "overlay" {
		t.Fatalf("role = %q, want overlay", role)
	}
}

func TestReaderReadsXYZTileWithoutReopeningDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.mbtiles")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB); INSERT INTO tiles VALUES (1, 1, 0, x'010203')`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	reader, err := OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	tile, err := reader.ReadTile(context.Background(), 1, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(tile), string([]byte{1, 2, 3}); got != want {
		t.Fatalf("tile = %v, want %v", tile, []byte{1, 2, 3})
	}
	_, err = reader.ReadTile(context.Background(), 1, 0, 1)
	if !errors.Is(err, ErrTileNotFound) {
		t.Fatalf("missing tile error = %v, want ErrTileNotFound", err)
	}
}

func TestArtifactPathRejectsTraversal(t *testing.T) {
	if _, err := ArtifactPath("/tiles", "../outside"); err == nil {
		t.Fatal("ArtifactPath accepted traversal")
	}
	path, err := ArtifactPath("/tiles", "0F4B437A-1EE7-4F3A-8B4B-1A2B3C4D5E6F")
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join("/tiles", "artifact-0f4b437a-1ee7-4f3a-8b4b-1a2b3c4d5e6f.mbtiles"); path != want {
		t.Fatalf("path = %q, want %q", path, want)
	}
}

func TestEnsureServingRolePreservesProducerRole(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.mbtiles")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE metadata (name TEXT, value TEXT); INSERT INTO metadata(name, value) VALUES ('type', 'baselayer')`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if err := EnsureServingRole(context.Background(), path, "overlay"); err != nil {
		t.Fatal(err)
	}
	db, err = sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var role string
	if err := db.QueryRow(`SELECT value FROM metadata WHERE name = 'type'`).Scan(&role); err != nil {
		t.Fatal(err)
	}
	if role != "baselayer" {
		t.Fatalf("role = %q, want producer role baselayer", role)
	}
}
