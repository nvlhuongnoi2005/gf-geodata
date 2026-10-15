// geodata-tile-gateway serves immutable, published tiles. It never exposes
// S3 addresses or credentials and never opens an MBTiles file per request.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/MicahParks/keyfunc/v3"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/catalog"
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/directory"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type gateway struct {
	store            *catalog.Store
	s3               *s3.Client
	bucket           string
	tileServerURL    string
	httpClient       *http.Client
	keys             keyfunc.Keyfunc
	issuer, audience string
	adminRole        string
	directory        *directory.Directory
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
	// object storage remains optional only for legacy releases published before
	// the TileServer-cache migration. New releases never read a tile from S3.
	if endpoint, accessKey, secretKey := strings.TrimSpace(os.Getenv("S3_ENDPOINT")), strings.TrimSpace(os.Getenv("S3_ACCESS_KEY")), strings.TrimSpace(os.Getenv("S3_SECRET_KEY")); endpoint != "" && accessKey != "" && secretKey != "" {
		cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(env("S3_REGION", "us-east-1")), awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")))
		if err != nil {
			log.Fatal(err)
		}
		objectStore = s3.NewFromConfig(cfg, func(o *s3.Options) { o.BaseEndpoint = aws.String(endpoint); o.UsePathStyle = true })
	}
	g := &gateway{store: store, s3: objectStore, bucket: env("S3_PUBLISHED_BUCKET", "geodata-published"), tileServerURL: strings.TrimRight(required("TILE_SERVER_INTERNAL_URL"), "/"), httpClient: &http.Client{Timeout: 10 * time.Second}, keys: keys, issuer: required("AUTH_ISSUER"), audience: required("AUTH_AUDIENCE"), adminRole: env("AUTH_ADMIN_ROLE", "admin"), directory: webgisDirectory}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", g.health)
	mux.HandleFunc("GET /v1/releases/{slug}/tilejson/{artifactID}", g.tileJSON)
	mux.HandleFunc("GET /v1/releases/{slug}/tiles/{artifactID}/{z}/{x}/{y}", g.tile)
	log.Fatal(http.ListenAndServe(env("HTTP_ADDR", ":8091"), mux))
}
func (g *gateway) health(w http.ResponseWriter, r *http.Request) {
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, g.tileServerURL+"/", nil)
	if err != nil {
		http.Error(w, "TileServer URL is invalid", http.StatusServiceUnavailable)
		return
	}
	response, err := g.httpClient.Do(request)
	if err != nil {
		http.Error(w, "TileServer is unavailable", http.StatusServiceUnavailable)
		return
	}
	_ = response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusInternalServerError {
		http.Error(w, "TileServer is unavailable", http.StatusServiceUnavailable)
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
			if a.ServingBackend == "tileserver_cache" {
				g.tileFromTileServer(w, r, release, a, z, x, y)
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
			if release.Visibility == "public" {
				w.Header().Set("Cache-Control", "public, max-age=86400")
			} else {
				w.Header().Set("Cache-Control", "private, max-age=86400")
			}
			_, _ = io.Copy(w, out.Body)
			return
		}
	}
	http.NotFound(w, r)
}

// tileFromTileServer retains GeoData authorization while delegating the hot
// tile read to TileServer's local MBTiles cache. It intentionally does not
// disclose the TileServer service name or its internal data endpoint.
func (g *gateway) tileFromTileServer(w http.ResponseWriter, r *http.Request, release catalog.MapRelease, artifact catalog.ReleaseArtifact, z, x, y int) {
	if artifact.TileServerDataset == "" || artifact.WarmStatus != "ready" {
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
	if release.Visibility == "public" {
		w.Header().Set("Cache-Control", "public, max-age=86400")
	} else {
		w.Header().Set("Cache-Control", "private, max-age=86400")
	}
	_, _ = io.Copy(w, response.Body)
}

func defaultJSON(value json.RawMessage, fallback string) json.RawMessage {
	if len(value) == 0 || !json.Valid(value) {
		return json.RawMessage(fallback)
	}
	return value
}
