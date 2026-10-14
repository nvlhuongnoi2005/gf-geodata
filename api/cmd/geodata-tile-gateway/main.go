// geodata-tile-gateway serves immutable, published tiles. It never exposes
// S3 addresses or credentials and never opens an MBTiles file per request.
package main

import (
	"context"
	"fmt"
	"github.com/MicahParks/keyfunc/v3"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/catalog"
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
	keys, err := keyfunc.NewDefault([]string{required("AUTH_JWKS_URL")})
	if err != nil {
		log.Fatal(err)
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(env("S3_REGION", "us-east-1")), awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(required("S3_ACCESS_KEY"), required("S3_SECRET_KEY"), "")))
	if err != nil {
		log.Fatal(err)
	}
	client := s3.NewFromConfig(cfg, func(o *s3.Options) { o.BaseEndpoint = aws.String(required("S3_ENDPOINT")); o.UsePathStyle = true })
	g := &gateway{store: store, s3: client, bucket: required("S3_PUBLISHED_BUCKET"), keys: keys, issuer: required("AUTH_ISSUER"), audience: required("AUTH_AUDIENCE")}
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
	if release.Visibility != "public" && !g.validJWT(r) {
		http.Error(w, "unauthorized", 401)
		return catalog.MapRelease{}, nil, false
	}
	if release.Visibility == "restricted" {
		http.Error(w, "restricted release ACL is not configured", 403)
		return catalog.MapRelease{}, nil, false
	}
	return release, arts, true
}
func (g *gateway) validJWT(r *http.Request) bool {
	h := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if h == r.Header.Get("Authorization") {
		return false
	}
	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(h, claims, g.keys.Keyfunc, jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}), jwt.WithIssuer(g.issuer), jwt.WithAudience(g.audience), jwt.WithExpirationRequired())
	return err == nil && token != nil && token.Valid
}
func (g *gateway) tileJSON(w http.ResponseWriter, r *http.Request) {
	_, arts, ok := g.release(w, r)
	if !ok {
		return
	}
	for _, a := range arts {
		if a.ArtifactID == r.PathValue("artifactID") {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"tilejson":"3.0.0","name":%q,"scheme":"xyz","format":%q,"minzoom":%d,"maxzoom":%d,"tiles":["/tiles/v1/releases/%s/tiles/%s/{z}/{x}/{y}"]}`, a.SourceName, a.TileFormat, a.MinZoom, a.MaxZoom, r.PathValue("slug"), a.ArtifactID)
			return
		}
	}
	http.NotFound(w, r)
}
func (g *gateway) tile(w http.ResponseWriter, r *http.Request) {
	_, arts, ok := g.release(w, r)
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
			w.Header().Set("Cache-Control", "public, max-age=86400")
			_, _ = io.Copy(w, out.Body)
			return
		}
	}
	http.NotFound(w, r)
}
