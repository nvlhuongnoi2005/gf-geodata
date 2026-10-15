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
	"os"
	"strconv"
	"strings"
	"time"
)

type gateway struct {
	store            *catalog.Store
	s3               *s3.Client
	bucket           string
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
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(env("S3_REGION", "us-east-1")), awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(required("S3_ACCESS_KEY"), required("S3_SECRET_KEY"), "")))
	if err != nil {
		log.Fatal(err)
	}
	client := s3.NewFromConfig(cfg, func(o *s3.Options) { o.BaseEndpoint = aws.String(required("S3_ENDPOINT")); o.UsePathStyle = true })
	g := &gateway{store: store, s3: client, bucket: required("S3_PUBLISHED_BUCKET"), keys: keys, issuer: required("AUTH_ISSUER"), audience: required("AUTH_AUDIENCE"), adminRole: env("AUTH_ADMIN_ROLE", "admin"), directory: webgisDirectory}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /v1/releases/{slug}/tilejson/{artifactID}", g.tileJSON)
	mux.HandleFunc("GET /v1/releases/{slug}/tiles/{artifactID}/{z}/{x}/{y}", g.tile)
	log.Fatal(http.ListenAndServe(env("HTTP_ADDR", ":8091"), mux))
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

func defaultJSON(value json.RawMessage, fallback string) json.RawMessage {
	if len(value) == 0 || !json.Valid(value) {
		return json.RawMessage(fallback)
	}
	return value
}
