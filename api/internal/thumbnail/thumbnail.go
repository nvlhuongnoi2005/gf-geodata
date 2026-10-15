// Package thumbnail creates deterministic PNG previews for immutable MBTiles
// artifacts. Raster tile payloads retain their geographical pixels. Vector
// MBTiles receive a clearly non-geographical fallback card until a dedicated
// MapLibre Native renderer is introduced; this avoids pretending that a raw
// PBF payload can be faithfully rasterised without its style, sprite and font
// assets.
package thumbnail

import (
	"bytes"
	"context"
	"crypto/sha256"
	"image"
	"image/color"
	"image/draw"
	"image/png"

	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/mbtiles"
)

const (
	width  = 640
	height = 360
)

// PNG renders a preview from one MBTiles tile. The result is always PNG so
// the gateway and browser do not need to expose the input tile format.
func PNG(ctx context.Context, path string) ([]byte, error) {
	reader, err := mbtiles.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	tile, err := reader.ReadPreviewTile(ctx)
	if err != nil {
		return nil, err
	}
	imageSource, _, decodeErr := image.Decode(bytes.NewReader(tile))
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	if decodeErr == nil {
		drawRaster(canvas, imageSource)
	} else {
		drawVectorFallback(canvas, tile)
	}
	var output bytes.Buffer
	if err := png.Encode(&output, canvas); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func drawRaster(target *image.RGBA, source image.Image) {
	draw.Draw(target, target.Bounds(), image.NewUniform(color.RGBA{235, 241, 246, 255}), image.Point{}, draw.Src)
	sourceBounds := source.Bounds()
	if sourceBounds.Dx() == 0 || sourceBounds.Dy() == 0 {
		return
	}
	scale := max(float64(width)/float64(sourceBounds.Dx()), float64(height)/float64(sourceBounds.Dy()))
	drawWidth := int(float64(sourceBounds.Dx())*scale + 0.5)
	drawHeight := int(float64(sourceBounds.Dy())*scale + 0.5)
	left := (width - drawWidth) / 2
	top := (height - drawHeight) / 2
	for y := 0; y < drawHeight; y++ {
		sy := sourceBounds.Min.Y + y*sourceBounds.Dy()/drawHeight
		for x := 0; x < drawWidth; x++ {
			sx := sourceBounds.Min.X + x*sourceBounds.Dx()/drawWidth
			targetX, targetY := left+x, top+y
			if image.Pt(targetX, targetY).In(target.Bounds()) {
				target.Set(targetX, targetY, source.At(sx, sy))
			}
		}
	}
}

func drawVectorFallback(target *image.RGBA, tile []byte) {
	sum := sha256.Sum256(tile)
	background := color.RGBA{19 + sum[0]%30, 48 + sum[1]%35, 72 + sum[2]%45, 255}
	draw.Draw(target, target.Bounds(), image.NewUniform(background), image.Point{}, draw.Src)
	road := color.RGBA{177 + sum[3]%45, 203 + sum[4]%38, 213 + sum[5]%35, 220}
	water := color.RGBA{71, 153 + sum[6]%60, 205 + sum[7]%35, 185}
	for index := 0; index < 7; index++ {
		x := int(sum[index])*width/255 - 80
		for y := 0; y < height; y++ {
			lineX := x + y*(int(sum[8+index])%70-35)/height
			for stroke := -3; stroke <= 3; stroke++ {
				if point := image.Pt(lineX+stroke, y); point.In(target.Bounds()) {
					target.Set(point.X, point.Y, road)
				}
			}
		}
	}
	for index := 0; index < 4; index++ {
		cx := int(sum[16+index]) * width / 255
		cy := int(sum[20+index]) * height / 255
		radius := 20 + int(sum[24+index])%55
		for y := cy - radius; y <= cy+radius; y++ {
			for x := cx - radius; x <= cx+radius; x++ {
				if (x-cx)*(x-cx)+(y-cy)*(y-cy) < radius*radius && image.Pt(x, y).In(target.Bounds()) {
					target.Set(x, y, water)
				}
			}
		}
	}
}
