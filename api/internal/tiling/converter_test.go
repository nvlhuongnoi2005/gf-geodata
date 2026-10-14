package tiling

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeRunner struct {
	command string
	args    []string
	output  string
}

func (r *fakeRunner) Run(_ context.Context, command string, args ...string) error {
	r.command, r.args = command, args
	return os.WriteFile(r.output, []byte("mbtiles"), 0o600)
}

func TestConvertOSMBuildsTilemakerCommand(t *testing.T) {
	tempDir := t.TempDir()
	input := filepath.Join(tempDir, "vietnam.osm.pbf")
	output := filepath.Join(tempDir, "out", "vietnam.mbtiles")
	if err := os.WriteFile(input, []byte("pbf"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{output: output}
	converter := New(Tools{OSMConfigPath: "/assets/config.json", OSMProcessPath: "/assets/process.lua"})
	converter.runner = runner
	if err := converter.Convert(context.Background(), Request{SourcePath: input, SourceType: FormatOSMPBF, OutputPath: output, Workspace: filepath.Join(tempDir, "work"), MinZoom: 0, MaxZoom: 14}); err != nil {
		t.Fatal(err)
	}
	if runner.command != "tilemaker" {
		t.Fatalf("command = %q", runner.command)
	}
	joined := strings.Join(runner.args, " ")
	for _, expected := range []string{"--input " + input, "--output " + output, "--config /assets/config.json", "--process /assets/process.lua", "--store"} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("missing %q in %q", expected, joined)
		}
	}
}

func TestConvertVectorBuildsMBTilesOptions(t *testing.T) {
	tempDir := t.TempDir()
	input := filepath.Join(tempDir, "roads.gpkg")
	output := filepath.Join(tempDir, "roads.mbtiles")
	if err := os.WriteFile(input, []byte("gpkg"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{output: output}
	converter := New(Tools{})
	converter.runner = runner
	if err := converter.Convert(context.Background(), Request{SourcePath: input, SourceType: FormatGeoPackage, OutputPath: output, Workspace: filepath.Join(tempDir, "work"), MinZoom: 4, MaxZoom: 16, LayerName: "roads"}); err != nil {
		t.Fatal(err)
	}
	if runner.command != "ogr2ogr" {
		t.Fatalf("command = %q", runner.command)
	}
	joined := strings.Join(runner.args, " ")
	for _, expected := range []string{"-f MBTILES", "MINZOOM=4", "MAXZOOM=16", "-nln roads", "-t_srs EPSG:3857"} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("missing %q in %q", expected, joined)
		}
	}
}

func TestExtractSingleShapefileRejectsUnsafePath(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "unsafe.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("../escape.shp")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("shape")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := extractSingleShapefile(archivePath, filepath.Join(t.TempDir(), "extract")); err == nil {
		t.Fatal("expected unsafe archive to fail")
	}
}
