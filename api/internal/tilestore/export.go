// Package tilestore publishes MBTiles as immutable individual tile objects.
// This makes the serving path one S3 GET per requested tile, never a full
// MBTiles download on a browser request.
package tilestore

import (
	"context"
	"database/sql"
	"fmt"
	"os"

	_ "modernc.org/sqlite"
)

type Tile struct {
	Z, X, Y int
	Data    []byte
}

func Export(ctx context.Context, path string, visit func(Tile) error) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, `SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles`)
	if err != nil {
		return fmt.Errorf("read MBTiles tiles: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var tile Tile
		if err := rows.Scan(&tile.Z, &tile.X, &tile.Y, &tile.Data); err != nil {
			return err
		}
		tile.Y = (1 << tile.Z) - 1 - tile.Y // MBTiles TMS -> WebMercator XYZ.
		if err := visit(tile); err != nil {
			return err
		}
	}
	return rows.Err()
}
