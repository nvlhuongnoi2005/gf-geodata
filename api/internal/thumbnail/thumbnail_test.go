package thumbnail

import (
	"bytes"
	"context"
	"database/sql"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestPNGUsesRasterTile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "sample.mbtiles")
	db, err := sql.Open("sqlite", file)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)`)
	if err != nil {
		t.Fatal(err)
	}
	input := image.NewRGBA(image.Rect(0, 0, 2, 2))
	input.Set(0, 0, color.RGBA{240, 40, 40, 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, input); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO tiles VALUES (3, 0, 0, ?)`, encoded.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}

	preview, err := PNG(context.Background(), file)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := png.Decode(bytes.NewReader(preview))
	if err != nil {
		t.Fatal(err)
	}
	if got := decoded.Bounds().Size(); got.X != width || got.Y != height {
		t.Fatalf("preview size=%v, want %dx%d", got, width, height)
	}
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("renderer must not replace the immutable MBTiles file: %v", err)
	}
}
