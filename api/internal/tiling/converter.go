// Package tiling converts a downloaded, trusted raw data file into an MBTiles
// artifact. It deliberately accepts local paths only: downloading from raw
// storage and publishing to derived storage belong to the job worker layer.
package tiling

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	FormatOSMPBF       = "osm_pbf"
	FormatGeoTIFF      = "geotiff"
	FormatGeoPackage   = "geopackage"
	FormatShapefileZip = "shapefile_zip"
	FormatMBTiles      = "mbtiles"
)

type Request struct {
	SourcePath string
	SourceType string
	OutputPath string
	Workspace  string
	MinZoom    int
	MaxZoom    int
	LayerName  string
}

type Tools struct {
	Tilemaker        string
	Ogr2Ogr          string
	GdalTranslate    string
	OSMConfigPath    string
	OSMProcessPath   string
	RasterTileFormat string
}

type Runner interface {
	Run(context.Context, string, ...string) error
}

type execRunner struct{}

func (execRunner) Run(ctx context.Context, command string, args ...string) error {
	output, err := exec.CommandContext(ctx, command, args...).CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			return fmt.Errorf("%s: %w", command, err)
		}
		return fmt.Errorf("%s: %w: %s", command, err, message)
	}
	return nil
}

type Converter struct {
	tools  Tools
	runner Runner
}

func New(tools Tools) *Converter {
	if tools.Tilemaker == "" {
		tools.Tilemaker = "tilemaker"
	}
	if tools.Ogr2Ogr == "" {
		tools.Ogr2Ogr = "ogr2ogr"
	}
	if tools.GdalTranslate == "" {
		tools.GdalTranslate = "gdal_translate"
	}
	if tools.RasterTileFormat == "" {
		tools.RasterTileFormat = "PNG"
	}
	return &Converter{tools: tools, runner: execRunner{}}
}

// Convert writes exactly one MBTiles artifact at OutputPath. The caller owns
// Workspace and must remove it after upload/publishing.
func (c *Converter) Convert(ctx context.Context, request Request) error {
	if err := validate(request); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(request.OutputPath), 0o750); err != nil {
		return err
	}
	if err := os.MkdirAll(request.Workspace, 0o750); err != nil {
		return err
	}
	if err := os.Remove(request.OutputPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	var err error
	switch request.SourceType {
	case FormatOSMPBF:
		err = c.convertOSM(ctx, request)
	case FormatGeoTIFF:
		err = c.convertRaster(ctx, request)
	case FormatGeoPackage:
		err = c.convertVector(ctx, request, request.SourcePath)
	case FormatShapefileZip:
		shapePath, extractErr := extractSingleShapefile(request.SourcePath, filepath.Join(request.Workspace, "shapefile"))
		if extractErr != nil {
			return extractErr
		}
		err = c.convertVector(ctx, request, shapePath)
	case FormatMBTiles:
		err = copyFile(request.SourcePath, request.OutputPath)
	default:
		return fmt.Errorf("unsupported conversion source type %q", request.SourceType)
	}
	if err != nil {
		return err
	}
	info, err := os.Stat(request.OutputPath)
	if err != nil {
		return fmt.Errorf("converter did not create MBTiles output: %w", err)
	}
	if info.Size() == 0 {
		return errors.New("converter created an empty MBTiles output")
	}
	return nil
}

func validate(request Request) error {
	if request.SourcePath == "" || request.OutputPath == "" || request.Workspace == "" {
		return errors.New("source path, output path and workspace are required")
	}
	if request.MinZoom < 0 || request.MaxZoom > 24 || request.MinZoom > request.MaxZoom {
		return fmt.Errorf("invalid zoom range %d-%d", request.MinZoom, request.MaxZoom)
	}
	info, err := os.Stat(request.SourcePath)
	if err != nil {
		return fmt.Errorf("read source file: %w", err)
	}
	if info.IsDir() {
		return errors.New("source path must be a file")
	}
	if strings.ToLower(filepath.Ext(request.OutputPath)) != ".mbtiles" {
		return errors.New("output path must end in .mbtiles")
	}
	return nil
}

func (c *Converter) convertOSM(ctx context.Context, request Request) error {
	if c.tools.OSMConfigPath == "" || c.tools.OSMProcessPath == "" {
		return errors.New("tilemaker config and process files are required for OSM PBF")
	}
	store := filepath.Join(request.Workspace, "tilemaker-store")
	if err := os.MkdirAll(store, 0o750); err != nil {
		return err
	}
	return c.runner.Run(ctx, c.tools.Tilemaker,
		"--input", request.SourcePath,
		"--output", request.OutputPath,
		"--config", c.tools.OSMConfigPath,
		"--process", c.tools.OSMProcessPath,
		"--store", store,
	)
}

func (c *Converter) convertVector(ctx context.Context, request Request, input string) error {
	args := []string{
		"-f", "MBTILES", request.OutputPath, input,
		"-t_srs", "EPSG:3857",
		"-dsco", fmt.Sprintf("MINZOOM=%d", request.MinZoom),
		"-dsco", fmt.Sprintf("MAXZOOM=%d", request.MaxZoom),
		"-dsco", "COMPRESS=YES",
		"-dsco", "MAX_SIZE=5000000",
		"-dsco", "MAX_FEATURES=2000000",
	}
	if request.LayerName != "" {
		args = append(args, "-nln", request.LayerName)
	}
	return c.runner.Run(ctx, c.tools.Ogr2Ogr, args...)
}

func (c *Converter) convertRaster(ctx context.Context, request Request) error {
	return c.runner.Run(ctx, c.tools.GdalTranslate,
		"-of", "MBTILES",
		"-co", "TILE_FORMAT="+strings.ToUpper(c.tools.RasterTileFormat),
		request.SourcePath, request.OutputPath,
	)
}

func extractSingleShapefile(zipPath, destination string) (string, error) {
	archive, err := zip.OpenReader(zipPath)
	if err != nil {
		return "", fmt.Errorf("open Shapefile archive: %w", err)
	}
	defer archive.Close()
	root := filepath.Clean(destination) + string(os.PathSeparator)
	var shapes []string
	for _, entry := range archive.File {
		name := filepath.Clean(entry.Name)
		if filepath.IsAbs(name) || strings.HasPrefix(name, ".."+string(os.PathSeparator)) || name == ".." {
			return "", errors.New("Shapefile archive contains an unsafe path")
		}
		target := filepath.Join(destination, name)
		if !strings.HasPrefix(filepath.Clean(target), root) {
			return "", errors.New("Shapefile archive escapes destination")
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o750); err != nil {
				return "", err
			}
			continue
		}
		if entry.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("Shapefile archive contains a symbolic link")
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return "", err
		}
		input, err := entry.Open()
		if err != nil {
			return "", err
		}
		output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o640)
		if err != nil {
			input.Close()
			return "", err
		}
		_, copyErr := io.Copy(output, input)
		closeErr := errors.Join(output.Close(), input.Close())
		if copyErr != nil {
			return "", copyErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		if strings.EqualFold(filepath.Ext(target), ".shp") {
			shapes = append(shapes, target)
		}
	}
	if len(shapes) != 1 {
		return "", fmt.Errorf("Shapefile archive must contain exactly one .shp file; found %d", len(shapes))
	}
	return shapes[0], nil
}

func copyFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o640)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	return errors.Join(copyErr, output.Close())
}
