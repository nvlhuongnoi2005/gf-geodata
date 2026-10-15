package mbtiles

import (
	"context"
	"database/sql"
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
