// geodata-tile-gateway serves immutable, published tiles. It never exposes
// S3 addresses or credentials and never opens an MBTiles file per request.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/catalog"
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/directory"
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/mbtiles"
)

type gateway struct {
	store            *catalog.Store
	s3               *s3.Client
	bucket           string
	styleBucket      string
	tileStoreRoot    string
	tileServerURL    string
	httpClient       *http.Client
	keys             keyfunc.Keyfunc
	issuer, audience string
	adminRole        string
	directory        *directory.Directory
	readerMu         sync.Mutex
	readers          map[string]*mbtiles.Reader
}

func required(n string) string {
	v := strings.TrimSpace(os.Getenv(n))
	if v == "" {
		log.Fatalf("required environment variable %s is not set", n)
	}
	return v
}
func main() {
	ctx := context.Background()
	store, err := catalog.Open(ctx, catalog.Config{Host: required("POSTGRES_HOST"), Port: os.Getenv("POSTGRES_PORT"), Database: required("POSTGRES_DATABASE"), User: required("POSTGRES_USER"), Password: required("POSTGRES_PASSWORD"), SSLMode: os.Getenv("POSTGRES_SSLMODE")})
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()
	var webgisDirectory *directory.Directory
	if dsn := strings.TrimSpace(os.Getenv("WEBGIS_DIRECTORY_DATABASE_URL")); dsn != "" {
		openedDirectory, directoryErr := directory.Open(ctx, dsn)
		if directoryErr != nil {
			log.Fatalf("connect WebGIS identity directory: %v", directoryErr)
		}
		webgisDirectory = openedDirectory
		defer webgisDirectory.Close()
	}
	keys, err := keyfunc.NewDefault([]string{required("AUTH_JWKS_URL")})
	if err != nil {
		log.Fatal(err)
	}
	var objectStore *s3.Client
	// Object storage remains optional only for legacy object-store releases.
	// New releases are served from the GeoData MBTiles volume.
	if endpoint, accessKey, secretKey := strings.TrimSpace(os.Getenv("S3_ENDPOINT")), strings.TrimSpace(os.Getenv("S3_ACCESS_KEY")), strings.TrimSpace(os.Getenv("S3_SECRET_KEY")); endpoint != "" && accessKey != "" && secretKey != "" {
		cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(env("S3_REGION", "us-east-1")), awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")))
		if err != nil {
			log.Fatal(err)
		}
		objectStore = s3.NewFromConfig(cfg, func(o *s3.Options) { o.BaseEndpoint = aws.String(endpoint); o.UsePathStyle = true })
	}
	g := &gateway{store: store, s3: objectStore, bucket: env("S3_PUBLISHED_BUCKET", "geodata-published"), styleBucket: env("S3_DERIVED_BUCKET", "geodata-derived"), tileStoreRoot: required("MBTILES_STORE_ROOT"), tileServerURL: strings.TrimRight(env("TILE_SERVER_INTERNAL_URL", ""), "/"), httpClient: &http.Client{Timeout: 10 * time.Second}, keys: keys, issuer: required("AUTH_ISSUER"), audience: required("AUTH_AUDIENCE"), adminRole: env("AUTH_ADMIN_ROLE", "admin"), directory: webgisDirectory, readers: map[string]*mbtiles.Reader{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", g.health)
	mux.HandleFunc("GET /v1/releases/{slug}/tilejson/{artifactID}", g.tileJSON)
	mux.HandleFunc("GET /v1/releases/{slug}/tiles/{artifactID}/{z}/{x}/{y}", g.tile)
	mux.HandleFunc("GET /v1/releases/{slug}/style.json", g.style)
	mux.HandleFunc("GET /v1/releases/{slug}/sprites/{styleID}/{name}", g.sprite)
	log.Fatal(http.ListenAndServe(env("HTTP_ADDR", ":8091"), mux))
}
func (g *gateway) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := g.store.Health(ctx); err != nil {
		http.Error(w, "catalog is unavailable", http.StatusServiceUnavailable)
		return
	}
	info, err := os.Stat(g.tileStoreRoot)
	if err != nil || !info.IsDir() {
		http.Error(w, "MBTiles serving volume is unavailable", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func env(n, d string) string {
	if v := strings.TrimSpace(os.Getenv(n)); v != "" {
		return v
	}
	return d
}
func (g *gateway) release(w http.ResponseWriter, r *http.Request) (catalog.MapRelease, []catalog.ReleaseArtifact, bool) {
	ctx, c := context.WithTimeout(r.Context(), 5*time.Second)
	defer c()
	release, arts, err := g.store.PublishedRelease(ctx, r.PathValue("slug"))
	if err != nil {
		http.NotFound(w, r)
		return catalog.MapRelease{}, nil, false
	}
	if release.Visibility != "public" {
		claims, ok := g.claims(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return catalog.MapRelease{}, nil, false
		}
		if isAdmin(claims, g.adminRole) {
			return release, arts, true
		}
		if release.Visibility == "restricted" {
			userID, _ := claims["sub"].(string)
			if userID == "" || g.directory == nil {
				http.Error(w, "restricted release directory is unavailable", http.StatusServiceUnavailable)
				return catalog.MapRelease{}, nil, false
			}
			organization, directoryErr := g.directory.OrganizationForUser(r.Context(), userID)
			if directoryErr != nil {
				http.Error(w, "forbidden", http.StatusForbidden)
				return catalog.MapRelease{}, nil, false
			}
			allowed, accessErr := g.store.CanViewRelease(r.Context(), release.ID, userID, organization)
			if accessErr != nil {
				http.Error(w, "access check unavailable", http.StatusServiceUnavailable)
				return catalog.MapRelease{}, nil, false
			}
			if !allowed {
				http.Error(w, "forbidden", http.StatusForbidden)
				return catalog.MapRelease{}, nil, false
			}
		}
	}
	return release, arts, true
}

func isAdmin(claims jwt.MapClaims, role string) bool {
	if claims["role"] == role {
		return true
	}
	if roles, ok := claims["roles"].([]any); ok {
		for _, item := range roles {
			if item == role {
				return true
			}
		}
	}
	if scopes, ok := claims["scope"].(string); ok {
		for _, scope := range strings.Fields(scopes) {
			if scope == "geodata:admin" {
				return true
			}
		}
	}
	return false
}

type tileJSONResponse struct {
	TileJSON     string          `json:"tilejson"`
	Name         string          `json:"name"`
	Scheme       string          `json:"scheme"`
	Format       string          `json:"format"`
	Tiles        []string        `json:"tiles"`
	Bounds       json.RawMessage `json:"bounds"`
	MinZoom      int             `json:"minzoom"`
	MaxZoom      int             `json:"maxzoom"`
	VectorLayers json.RawMessage `json:"vector_layers,omitempty"`
}

func (g *gateway) claims(r *http.Request) (jwt.MapClaims, bool) {
	h := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if h == r.Header.Get("Authorization") {
		return nil, false
	}
	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(h, claims, g.keys.Keyfunc, jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}), jwt.WithIssuer(g.issuer), jwt.WithAudience(g.audience), jwt.WithExpirationRequired())
	return claims, err == nil && token != nil && token.Valid
}
func (g *gateway) tileJSON(w http.ResponseWriter, r *http.Request) {
	_, arts, ok := g.release(w, r)
	if !ok {
		return
	}
	for _, a := range arts {
		if a.ArtifactID == r.PathValue("artifactID") {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(tileJSONResponse{
				TileJSON: "3.0.0", Name: a.SourceName, Scheme: "xyz", Format: a.TileFormat,
				Tiles:  []string{"/tiles/v1/releases/" + r.PathValue("slug") + "/tiles/" + a.ArtifactID + "/{z}/{x}/{y}"},
				Bounds: defaultJSON(a.Bounds, "[-180,-85.051129,180,85.051129]"), MinZoom: a.MinZoom, MaxZoom: a.MaxZoom,
				VectorLayers: defaultJSON(a.VectorLayers, "[]"),
			})
			return
		}
	}
	http.NotFound(w, r)
}

// style resolves a stored style against the selected release. A source such
// as mbtiles://vietnam is an import-time placeholder; it becomes the release's
// private TileJSON endpoint here, so a browser never learns an S3 key or a
// filesystem path. Existing releases without a style continue using the UI's
// automatic fallback style.
func (g *gateway) style(w http.ResponseWriter, r *http.Request) {
	release, artifacts, ok := g.release(w, r)
	if !ok {
		return
	}
	style, err := g.store.StyleForRelease(r.Context(), release.ID)
	if err != nil {
		log.Printf("load release style %s: %v", release.ID, err)
		http.Error(w, "style is temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	if style == nil || len(artifacts) == 0 {
		http.NotFound(w, r)
		return
	}
	var document map[string]any
	if json.Unmarshal(style.Document, &document) != nil {
		http.Error(w, "stored style is invalid", http.StatusInternalServerError)
		return
	}
	if sources, valid := document["sources"].(map[string]any); valid {
		for _, sourceValue := range sources {
			source, valid := sourceValue.(map[string]any)
			if !valid {
				continue
			}
			if sourceURL, valid := source["url"].(string); valid && strings.HasPrefix(strings.ToLower(sourceURL), "mbtiles://") {
				source["url"] = "/tiles/v1/releases/" + release.Slug + "/tilejson/" + artifacts[0].ArtifactID
			}
		}
	}
	if style.HasSprite {
		document["sprite"] = "/tiles/v1/releases/" + release.Slug + "/sprites/" + style.ID + "/sprite"
	} else {
		delete(document, "sprite")
	}
	// The supplied OpenStreetMap style references fonts://. No glyph PBF files
	// accompanied it, so do not leave a custom protocol URL which would make
	// MapLibre fail. Symbols without glyphs are simply omitted until a verified
	// font package is imported in a later style version.
	if !style.HasGlyphs {
		delete(document, "glyphs")
	}
	w.Header().Set("Content-Type", "application/json")
	setTileCacheControl(w, release)
	_ = json.NewEncoder(w).Encode(document)
}

func (g *gateway) sprite(w http.ResponseWriter, r *http.Request) {
	release, _, ok := g.release(w, r)
	if !ok {
		return
	}
	style, err := g.store.StyleForRelease(r.Context(), release.ID)
	if err != nil {
		http.Error(w, "style is temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	if style == nil || !style.HasSprite || style.ID != r.PathValue("styleID") {
		http.NotFound(w, r)
		return
	}
	name := r.PathValue("name")
	contentType := ""
	switch name {
	case "sprite.json", "sprite@2x.json":
		contentType = "application/json"
	case "sprite.png", "sprite@2x.png":
		contentType = "image/png"
	default:
		http.NotFound(w, r)
		return
	}
	if g.s3 == nil {
		http.Error(w, "style storage is unavailable", http.StatusServiceUnavailable)
		return
	}
	object, err := g.s3.GetObject(r.Context(), &s3.GetObjectInput{Bucket: aws.String(g.styleBucket), Key: aws.String("styles/" + style.ID + "/" + name)})
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer object.Body.Close()
	w.Header().Set("Content-Type", contentType)
	setTileCacheControl(w, release)
	_, _ = io.Copy(w, object.Body)
}
func (g *gateway) tile(w http.ResponseWriter, r *http.Request) {
	release, arts, ok := g.release(w, r)
	if !ok {
		return
	}
	z, e1 := strconv.Atoi(r.PathValue("z"))
	x, e2 := strconv.Atoi(r.PathValue("x"))
	y, e3 := strconv.Atoi(r.PathValue("y"))
	if e1 != nil || e2 != nil || e3 != nil || z < 0 || x < 0 || y < 0 {
		http.NotFound(w, r)
		return
	}
	for _, a := range arts {
		if a.ArtifactID == r.PathValue("artifactID") {
			switch a.ServingBackend {
			case "geodata_mbtiles":
				g.tileFromMBTiles(w, r, release, a, z, x, y)
				return
			case "tileserver_cache":
				g.tileFromTileServer(w, r, release, a, z, x, y)
				return
			}
			if a.ServingBackend != "object_store" {
				http.NotFound(w, r)
				return
			}
			if g.s3 == nil {
				http.Error(w, "legacy tile storage is unavailable", http.StatusServiceUnavailable)
				return
			}
			key := fmt.Sprintf("%s/tiles/%d/%d/%d.%s", a.TilePrefix, z, x, y, a.TileFormat)
			ctx, c := context.WithTimeout(r.Context(), 10*time.Second)
			defer c()
			out, err := g.s3.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(g.bucket), Key: aws.String(key)})
			if err != nil {
				http.NotFound(w, r)
				return
			}
			defer out.Body.Close()
			w.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")
			setTileCacheControl(w, release)
			_, _ = io.Copy(w, out.Body)
			return
		}
	}
	http.NotFound(w, r)
}

// tileFromMBTiles is the normal serving path. The gateway has already checked
// release state and WebGIS-derived access policy before it opens the immutable
// artifact stored on GeoData's own persistent volume.
func (g *gateway) tileFromMBTiles(w http.ResponseWriter, r *http.Request, release catalog.MapRelease, artifact catalog.ReleaseArtifact, z, x, y int) {
	if artifact.WarmStatus != "ready" {
		http.NotFound(w, r)
		return
	}
	reader, err := g.readerForArtifact(artifact.ArtifactID)
	if err != nil {
		log.Printf("open MBTiles artifact %s: %v", artifact.ArtifactID, err)
		http.Error(w, "tile data is temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	entityTag := `W/"` + artifact.ArtifactID + "-" + strconv.Itoa(z) + "-" + strconv.Itoa(x) + "-" + strconv.Itoa(y) + `"`
	if r.Header.Get("If-None-Match") == entityTag {
		w.Header().Set("ETag", entityTag)
		w.WriteHeader(http.StatusNotModified)
		return
	}
	tile, err := reader.ReadTile(r.Context(), z, x, y)
	if errors.Is(err, mbtiles.ErrTileNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		log.Printf("read MBTiles artifact %s: %v", artifact.ArtifactID, err)
		http.Error(w, "tile data is temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", tileContentType(artifact.TileFormat))
	if len(tile) >= 2 && tile[0] == 0x1f && tile[1] == 0x8b {
		w.Header().Set("Content-Encoding", "gzip")
	}
	w.Header().Set("ETag", entityTag)
	setTileCacheControl(w, release)
	_, _ = w.Write(tile)
}

func (g *gateway) readerForArtifact(artifactID string) (*mbtiles.Reader, error) {
	g.readerMu.Lock()
	defer g.readerMu.Unlock()
	if reader := g.readers[artifactID]; reader != nil {
		return reader, nil
	}
	path, err := mbtiles.ArtifactPath(g.tileStoreRoot, artifactID)
	if err != nil {
		return nil, err
	}
	reader, err := mbtiles.OpenReader(path)
	if err != nil {
		return nil, err
	}
	g.readers[artifactID] = reader
	return reader, nil
}

func tileContentType(format string) string {
	switch strings.ToLower(format) {
	case "pbf", "mvt":
		return "application/vnd.mapbox-vector-tile"
	case "png":
		return "image/png"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

func setTileCacheControl(w http.ResponseWriter, release catalog.MapRelease) {
	if release.Visibility == "public" {
		w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
}

// tileFromTileServer retains GeoData authorization while delegating the hot
// tile read to TileServer's local MBTiles cache. It intentionally does not
// disclose the TileServer service name or its internal data endpoint.
func (g *gateway) tileFromTileServer(w http.ResponseWriter, r *http.Request, release catalog.MapRelease, artifact catalog.ReleaseArtifact, z, x, y int) {
	if g.tileServerURL == "" || artifact.TileServerDataset == "" || artifact.WarmStatus != "ready" {
		http.NotFound(w, r)
		return
	}
	extension := artifact.TileFormat
	if extension == "" {
		extension = "pbf"
	}
	target := fmt.Sprintf("%s/datas/%s/%d/%d/%d.%s", g.tileServerURL, url.PathEscape(artifact.TileServerDataset), z, x, y, extension)
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	response, err := g.httpClient.Do(request)
	if err != nil {
		http.Error(w, "TileServer is unavailable", http.StatusServiceUnavailable)
		return
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		http.NotFound(w, r)
		return
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		http.Error(w, "TileServer failed to serve the tile", http.StatusBadGateway)
		return
	}
	contentType := response.Header.Get("Content-Type")
	if contentType == "" {
		if extension == "pbf" || extension == "mvt" {
			contentType = "application/vnd.mapbox-vector-tile"
		} else {
			contentType = "image/" + extension
		}
	}
	w.Header().Set("Content-Type", contentType)
	if etag := response.Header.Get("ETag"); etag != "" {
		w.Header().Set("ETag", etag)
	}
	setTileCacheControl(w, release)
	_, _ = io.Copy(w, response.Body)
}

func defaultJSON(value json.RawMessage, fallback string) json.RawMessage {
	if len(value) == 0 || !json.Valid(value) {
		return json.RawMessage(fallback)
	}
	return value
}
