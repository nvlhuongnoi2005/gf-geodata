package tilestore

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func createMBTiles(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "tiles.mbtiles")
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (3, 5, 1, X'0102'), (0, 0, 0, X'03')`); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestExportConvertsTMSRowsToXYZ(t *testing.T) {
	path := createMBTiles(t)
	var tiles []Tile
	if err := Export(context.Background(), path, func(tile Tile) error {
		tiles = append(tiles, tile)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(tiles) != 2 {
		t.Fatalf("exported %d tiles, want 2", len(tiles))
	}
	if got, want := tiles[0], (Tile{Z: 3, X: 5, Y: 6, Data: []byte{1, 2}}); got.Z != want.Z || got.X != want.X || got.Y != want.Y || string(got.Data) != string(want.Data) {
		t.Fatalf("first tile = %#v, want %#v", got, want)
	}
	if got, want := tiles[1], (Tile{Z: 0, X: 0, Y: 0, Data: []byte{3}}); got.Z != want.Z || got.X != want.X || got.Y != want.Y || string(got.Data) != string(want.Data) {
		t.Fatalf("second tile = %#v, want %#v", got, want)
	}
}

func TestExportStopsWhenVisitorFails(t *testing.T) {
	path := createMBTiles(t)
	want := errors.New("stop exporting")
	err := Export(context.Background(), path, func(Tile) error { return want })
	if !errors.Is(err, want) {
		t.Fatalf("Export error = %v, want %v", err, want)
	}
}
