package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" { panic("DATABASE_URL is required") }
	path := os.Getenv("GEODATA_MIGRATION_FILE")
	if path == "" { path = "/migrations/001_metadata.sql" }
	sql, err := os.ReadFile(filepath.Clean(path)); if err != nil { panic(err) }
	pool, err := pgxpool.New(context.Background(), databaseURL); if err != nil { panic(err) }
	defer pool.Close()
	if _, err = pool.Exec(context.Background(), string(sql)); err != nil { panic(err) }
	fmt.Println("Applied metadata migration")
}
