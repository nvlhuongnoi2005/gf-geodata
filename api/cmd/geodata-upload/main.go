package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/catalog"
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/mbtiles"
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/tilegateway"
)

type uploadListResponse struct {
	Items []catalog.RawUpload `json:"items"`
}

type conversionJobListResponse struct {
	Items []catalog.ConversionJobView `json:"items"`
}

type conversionArtifactListResponse struct {
	Items []catalog.ConversionArtifactView `json:"items"`
}
type createReleaseRequest struct {
	Name        string   `json:"name"`
	Slug        string   `json:"slug"`
	Description string   `json:"description"`
	Visibility  string   `json:"visibility"`
	ArtifactIDs []string `json:"artifactIds"`
}
type releaseListResponse struct {
	Items []catalog.MapRelease `json:"items"`
}

type tileJSONResponse struct {
	TileJSON     string                `json:"tilejson"`
	Name         string                `json:"name"`
	Scheme       string                `json:"scheme"`
	Format       string                `json:"format"`
	Tiles        []string              `json:"tiles"`
	Bounds       []float64             `json:"bounds"`
	MinZoom      int                   `json:"minzoom"`
	MaxZoom      int                   `json:"maxzoom"`
	VectorLayers []mbtiles.VectorLayer `json:"vector_layers,omitempty"`
}

type createConversionJobRequest struct {
	RawUploadID string `json:"rawUploadId"`
	MinZoom     int    `json:"minZoom"`
	MaxZoom     int    `json:"maxZoom"`
	LayerName   string `json:"layerName"`
}

type conversionJobResponse struct {
	ID          string    `json:"id"`
	RawUploadID string    `json:"rawUploadId"`
	Status      string    `json:"status"`
	MinZoom     int       `json:"minZoom"`
	MaxZoom     int       `json:"maxZoom"`
	LayerName   string    `json:"layerName,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

type serviceState string

const (
	serviceReady       serviceState = "ready"
	serviceDegraded    serviceState = "degraded"
	serviceUnavailable serviceState = "unavailable"
)

type serviceSummary struct {
	Name  string       `json:"name"`
	State serviceState `json:"state"`
}

type summaryResponse struct {
	Datasets int `json:"datasets"`
	Jobs     struct {
		Queued  int `json:"queued"`
		Running int `json:"running"`
		Failed  int `json:"failed"`
	} `json:"jobs"`
	Releases  int              `json:"releases"`
	Services  []serviceSummary `json:"services"`
	Generated time.Time        `json:"generatedAt"`
}

type actorContextKey struct{}

func required(name string) string {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		log.Fatalf("required environment variable %s is not set", name)
	}
	return v
}

func main() {
	maxBytes := int64(50 << 30)
	if raw := os.Getenv("MAX_UPLOAD_BYTES"); raw != "" {
		if _, err := fmt.Sscan(raw, &maxBytes); err != nil || maxBytes < 1 {
			log.Fatal("MAX_UPLOAD_BYTES must be a positive integer")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := openCatalog(ctx)
	defer store.Close()

	jwksURL := required("AUTH_JWKS_URL")
	keys, err := keyfunc.NewDefaultCtx(ctx, []string{jwksURL})
	if err != nil {
		log.Fatalf("load auth JWKS: %v", err)
	}
	issuer, audience := required("AUTH_ISSUER"), required("AUTH_AUDIENCE")
	roleName := os.Getenv("AUTH_ADMIN_ROLE")
	if roleName == "" {
		roleName = "admin"
	}
	region := os.Getenv("S3_REGION")
	if region == "" {
		region = "us-east-1"
	}
	endpoint := required("S3_ENDPOINT")
	accessKey, secretKey := required("S3_ACCESS_KEY"), required("S3_SECRET_KEY")
	base, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(region),
		config.WithCredentialsProvider(aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) {
			return aws.Credentials{AccessKeyID: accessKey, SecretAccessKey: secretKey, Source: "geodata-upload-secret"}, nil
		})),
	)
	if err != nil {
		log.Fatalf("configure S3 client: %v", err)
	}
	objectStore := s3.NewFromConfig(base, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		o.UsePathStyle = true
	})
	uploader := manager.NewUploader(objectStore, func(u *manager.Uploader) {
		u.PartSize = 64 * 1024 * 1024
		u.Concurrency = 2
	})
	tileCache, err := tilegateway.NewCache(required("TILE_CACHE_DIR"), required("S3_DERIVED_BUCKET"), objectStore)
	if err != nil {
		log.Fatalf("configure tile cache: %v", err)
	}
	app := &server{
		keys: keys, issuer: issuer, audience: audience, adminRole: roleName,
		bucket: required("S3_BUCKET"), derivedBucket: required("S3_DERIVED_BUCKET"), maxUploadBytes: maxBytes, uploader: uploader,
		objectStore: objectStore, store: store, tileCache: tileCache, authJWKSURL: jwksURL,
		tileGatewayHealthURL: strings.TrimSpace(os.Getenv("TILE_GATEWAY_HEALTH_URL")),
		healthClient:         &http.Client{Timeout: 3 * time.Second},
		uploadSlots:          make(chan struct{}, 2),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.Handle("GET /api/geodata/v1/summary", app.requireAdmin(http.HandlerFunc(app.summary)))
	mux.Handle("GET /api/geodata/v1/uploads", app.requireAdmin(http.HandlerFunc(app.listUploads)))
	mux.Handle("PUT /api/geodata/v1/uploads", app.requireAdmin(http.HandlerFunc(app.upload)))
	mux.Handle("DELETE /api/geodata/v1/uploads/{uploadID}", app.requireAdmin(http.HandlerFunc(app.deleteUpload)))
	mux.Handle("GET /api/geodata/v1/jobs", app.requireAdmin(http.HandlerFunc(app.listConversionJobs)))
	mux.Handle("POST /api/geodata/v1/jobs", app.requireAdmin(http.HandlerFunc(app.createConversionJob)))
	mux.Handle("POST /api/geodata/v1/jobs/{jobID}/cancel", app.requireAdmin(http.HandlerFunc(app.cancelConversionJob)))
	mux.Handle("DELETE /api/geodata/v1/jobs/{jobID}", app.requireAdmin(http.HandlerFunc(app.deleteConversionJob)))
	mux.Handle("GET /api/geodata/v1/artifacts", app.requireAdmin(http.HandlerFunc(app.listConversionArtifacts)))
	mux.Handle("GET /api/geodata/v1/artifacts/{artifactID}/tilejson", app.requireAdmin(http.HandlerFunc(app.artifactTileJSON)))
	mux.Handle("GET /api/geodata/v1/artifacts/{artifactID}/tiles/{z}/{x}/{y}", app.requireAdmin(http.HandlerFunc(app.artifactTile)))
	mux.Handle("GET /api/geodata/v1/releases", app.requireAdmin(http.HandlerFunc(app.listReleases)))
	mux.Handle("POST /api/geodata/v1/releases", app.requireAdmin(http.HandlerFunc(app.createRelease)))
	mux.Handle("POST /api/geodata/v1/releases/{releaseID}/publish", app.requireAdmin(http.HandlerFunc(app.publishRelease)))
	mux.Handle("POST /api/geodata/v1/releases/{releaseID}/unpublish", app.requireAdmin(http.HandlerFunc(app.unpublishRelease)))
	mux.Handle("DELETE /api/geodata/v1/releases/{releaseID}", app.requireAdmin(http.HandlerFunc(app.deleteRelease)))
	address := os.Getenv("HTTP_ADDR")
	if address == "" {
		address = ":8090"
	}
	httpServer := &http.Server{Addr: address, Handler: securityHeaders(mux), ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout: 2 * time.Minute, MaxHeaderBytes: 16 * 1024}
	slog.Info("geodata raw upload API listening", "address", address)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func openCatalog(ctx context.Context) *catalog.Store {
	cfg := catalog.Config{
		Host: required("POSTGRES_HOST"), Port: os.Getenv("POSTGRES_PORT"),
		Database: required("POSTGRES_DATABASE"), User: required("POSTGRES_USER"),
		Password: required("POSTGRES_PASSWORD"), SSLMode: os.Getenv("POSTGRES_SSLMODE"),
	}
	deadline := time.Now().Add(75 * time.Second)
	for {
		attemptCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		store, err := catalog.Open(attemptCtx, cfg)
		if err == nil {
			err = store.Migrate(attemptCtx)
		}
		cancel()
		if err == nil {
			return store
		}
		if store != nil {
			store.Close()
		}
		if time.Now().After(deadline) {
			log.Fatalf("connect or migrate geodata catalog: %v", err)
		}
		slog.Warn("geodata catalog is not ready; retrying", "error", err)
		time.Sleep(3 * time.Second)
	}
}

type server struct {
	keys                                               keyfunc.Keyfunc
	issuer, audience, adminRole, bucket, derivedBucket string
	maxUploadBytes                                     int64
	uploader                                           *manager.Uploader
	objectStore                                        *s3.Client
	store                                              *catalog.Store
	tileCache                                          *tilegateway.Cache
	authJWKSURL, tileGatewayHealthURL                  string
	healthClient                                       *http.Client
	uploadSlots                                        chan struct{}
}

func (s *server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := strings.TrimSpace(r.Header.Get("Authorization"))
		if !strings.HasPrefix(header, "Bearer ") {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		claims := jwt.MapClaims{}
		token, err := jwt.ParseWithClaims(strings.TrimPrefix(header, "Bearer "), claims, s.keys.Keyfunc,
			jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}), jwt.WithIssuer(s.issuer), jwt.WithAudience(s.audience), jwt.WithExpirationRequired())
		if err != nil || token == nil || !token.Valid {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if !isAdmin(claims, s.adminRole) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		subject, _ := claims["sub"].(string)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorContextKey{}, subject)))
	})
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

func (s *server) listUploads(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			http.Error(w, "limit must be between 1 and 100", http.StatusBadRequest)
			return
		}
		limit = parsed
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	items, err := s.store.List(ctx, limit)
	if err != nil {
		slog.Error("list raw upload metadata failed", "error", err)
		http.Error(w, "could not load source data", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(uploadListResponse{Items: items})
}

func (s *server) summary(w http.ResponseWriter, r *http.Request) {
	response := summaryResponse{Generated: time.Now().UTC()}
	response.Services = []serviceSummary{
		{Name: "authentication", State: s.checkHTTPService(r.Context(), s.authJWKSURL)},
		{Name: "storage", State: s.checkStorage(r.Context())},
		{Name: "catalog", State: s.checkCatalog(r.Context(), &response)},
		{Name: "tiles", State: s.checkOptionalHTTPService(r.Context(), s.tileGatewayHealthURL)},
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func (s *server) listConversionJobs(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			http.Error(w, "limit must be between 1 and 100", http.StatusBadRequest)
			return
		}
		limit = parsed
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	items, err := s.store.ListConversionJobs(ctx, limit)
	if err != nil {
		slog.Error("list conversion jobs", "error", err)
		http.Error(w, "could not load conversion jobs", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(conversionJobListResponse{Items: items})
}

func (s *server) listConversionArtifacts(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			http.Error(w, "limit must be between 1 and 100", http.StatusBadRequest)
			return
		}
		limit = parsed
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	items, err := s.store.ListConversionArtifacts(ctx, limit)
	if err != nil {
		slog.Error("list conversion artifacts", "error", err)
		http.Error(w, "could not load converted data", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(conversionArtifactListResponse{Items: items})
}

func (s *server) artifactTileJSON(w http.ResponseWriter, r *http.Request) {
	artifact, _, metadata, ok := s.loadPreviewArtifact(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(tileJSONResponse{
		TileJSON: "3.0.0", Name: artifact.SourceName, Scheme: "xyz", Format: metadata.Format,
		Tiles:  []string{"/api/geodata/v1/artifacts/" + artifact.ID + "/tiles/{z}/{x}/{y}"},
		Bounds: metadata.Bounds.Values(), MinZoom: metadata.MinZoom, MaxZoom: metadata.MaxZoom,
		VectorLayers: metadata.VectorLayers,
	})
}

func (s *server) artifactTile(w http.ResponseWriter, r *http.Request) {
	_, path, metadata, ok := s.loadPreviewArtifact(w, r)
	if !ok {
		return
	}
	z, zErr := strconv.Atoi(r.PathValue("z"))
	x, xErr := strconv.Atoi(r.PathValue("x"))
	y, yErr := strconv.Atoi(r.PathValue("y"))
	if zErr != nil || xErr != nil || yErr != nil {
		http.Error(w, "invalid tile coordinates", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	tile, err := mbtiles.ReadTile(ctx, path, z, x, y)
	if errors.Is(err, mbtiles.ErrTileNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		slog.Error("read preview tile", "error", err)
		http.Error(w, "could not read map tile", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", tileContentType(metadata.Format))
	w.Header().Set("Cache-Control", "private, max-age=300")
	_, _ = w.Write(tile)
}

func (s *server) listReleases(w http.ResponseWriter, r *http.Request) {
	ctx, c := context.WithTimeout(r.Context(), 10*time.Second)
	defer c()
	items, err := s.store.ListReleases(ctx, 100)
	if err != nil {
		http.Error(w, "could not load releases", 503)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(releaseListResponse{Items: items})
}
func (s *server) createRelease(w http.ResponseWriter, r *http.Request) {
	var request createReleaseRequest
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	defer r.Body.Close()
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if d.Decode(&request) != nil || strings.TrimSpace(request.Name) == "" || !validSlug(request.Slug) || len(request.ArtifactIDs) == 0 || len(request.ArtifactIDs) > 20 || (request.Visibility != "public" && request.Visibility != "authenticated" && request.Visibility != "restricted") {
		http.Error(w, "invalid release request", 400)
		return
	}
	for _, id := range request.ArtifactIDs {
		if !isUUID(id) {
			http.Error(w, "invalid artifact", 400)
			return
		}
	}
	id, err := newUUID()
	if err != nil {
		http.Error(w, "could not create release", 500)
		return
	}
	release := catalog.MapRelease{ID: id, Name: strings.TrimSpace(request.Name), Slug: request.Slug, Description: strings.TrimSpace(request.Description), Visibility: request.Visibility, Status: "draft", CreatedAt: time.Now().UTC()}
	ctx, c := context.WithTimeout(r.Context(), 10*time.Second)
	defer c()
	if err = s.store.CreateRelease(ctx, release, request.ArtifactIDs); err != nil {
		http.Error(w, "could not create release", 409)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(201)
	_ = json.NewEncoder(w).Encode(release)
}
func (s *server) publishRelease(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("releaseID")
	if !isUUID(id) {
		http.Error(w, "invalid release identifier", 400)
		return
	}
	ctx, c := context.WithTimeout(r.Context(), 10*time.Second)
	defer c()
	if err := s.store.StartReleasePublish(ctx, id); err != nil {
		http.Error(w, "release is not a draft", 409)
		return
	}
	w.WriteHeader(202)
}
func (s *server) unpublishRelease(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("releaseID")
	if !isUUID(id) {
		http.Error(w, "invalid release identifier", 400)
		return
	}
	ctx, c := context.WithTimeout(r.Context(), 10*time.Second)
	defer c()
	if err := s.store.UnpublishRelease(ctx, id); err != nil {
		http.Error(w, "release is not published", 409)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *server) deleteRelease(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("releaseID")
	if !isUUID(id) {
		http.Error(w, "invalid release identifier", 400)
		return
	}
	ctx, c := context.WithTimeout(r.Context(), 10*time.Second)
	defer c()
	if err := s.store.DeleteRelease(ctx, id); err != nil {
		http.Error(w, "only an unpublished release can be deleted", 409)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func validSlug(value string) bool {
	if len(value) < 1 || len(value) > 120 {
		return false
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
			return false
		}
	}
	return !strings.HasPrefix(value, "-") && !strings.HasSuffix(value, "-")
}

func (s *server) loadPreviewArtifact(w http.ResponseWriter, r *http.Request) (catalog.ConversionArtifact, string, mbtiles.Metadata, bool) {
	id := r.PathValue("artifactID")
	if !isUUID(id) {
		http.Error(w, "invalid converted data identifier", http.StatusBadRequest)
		return catalog.ConversionArtifact{}, "", mbtiles.Metadata{}, false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	artifact, err := s.store.ConversionArtifact(ctx, id)
	if errors.Is(err, catalog.ErrConversionJobNotFound) {
		http.NotFound(w, r)
		return catalog.ConversionArtifact{}, "", mbtiles.Metadata{}, false
	}
	if err != nil {
		slog.Error("load converted artifact", "artifact_id", id, "error", err)
		http.Error(w, "could not load converted data", http.StatusServiceUnavailable)
		return catalog.ConversionArtifact{}, "", mbtiles.Metadata{}, false
	}
	path, err := s.tileCache.Ensure(ctx, artifact.ID, artifact.OutputObjectKey)
	if err != nil {
		slog.Error("cache converted artifact", "artifact_id", id, "error", err)
		http.Error(w, "could not prepare map preview", http.StatusBadGateway)
		return catalog.ConversionArtifact{}, "", mbtiles.Metadata{}, false
	}
	metadata, err := mbtiles.ReadMetadata(ctx, path)
	if err != nil {
		slog.Error("read converted artifact metadata", "artifact_id", id, "error", err)
		http.Error(w, "converted data is not a valid MBTiles file", http.StatusUnprocessableEntity)
		return catalog.ConversionArtifact{}, "", mbtiles.Metadata{}, false
	}
	return artifact, path, metadata, true
}

func tileContentType(format string) string {
	switch strings.ToLower(format) {
	case "pbf", "mvt":
		return "application/vnd.mapbox-vector-tile"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	default:
		return "image/png"
	}
}

func (s *server) checkHTTPService(parent context.Context, endpoint string) serviceState {
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return serviceDegraded
	}
	response, err := s.healthClient.Do(request)
	if err != nil {
		return serviceDegraded
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return serviceDegraded
	}
	return serviceReady
}

func (s *server) checkOptionalHTTPService(ctx context.Context, endpoint string) serviceState {
	if endpoint == "" {
		return serviceUnavailable
	}
	return s.checkHTTPService(ctx, endpoint)
}

func (s *server) checkStorage(parent context.Context) serviceState {
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	_, err := s.objectStore.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket:  aws.String(s.bucket),
		MaxKeys: aws.Int32(1),
	})
	if err != nil {
		slog.Warn("storage health check failed", "error", err)
		return serviceDegraded
	}
	return serviceReady
}

func (s *server) checkCatalog(parent context.Context, response *summaryResponse) serviceState {
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	if err := s.store.Health(ctx); err != nil {
		slog.Warn("catalog health check failed", "error", err)
		return serviceDegraded
	}
	count, err := s.store.CountRawUploads(ctx)
	if err != nil {
		slog.Warn("catalog count failed", "error", err)
		return serviceDegraded
	}
	response.Datasets = count
	jobs, err := s.store.JobCounts(ctx)
	if err != nil {
		slog.Warn("catalog job count failed", "error", err)
		return serviceDegraded
	}
	response.Jobs.Queued = jobs.Queued
	response.Jobs.Running = jobs.Running
	response.Jobs.Failed = jobs.Failed
	return serviceReady
}

func (s *server) upload(w http.ResponseWriter, r *http.Request) {
	fileName := r.URL.Query().Get("filename")
	if fileName == "" || len(fileName) > 255 || filepath.Base(fileName) != fileName || strings.ContainsAny(fileName, "/\\\x00") {
		http.Error(w, "invalid file name", http.StatusBadRequest)
		return
	}
	format, supported := catalog.SourceFormat(fileName)
	if !supported {
		http.Error(w, "unsupported file format", http.StatusUnsupportedMediaType)
		return
	}
	dataName := strings.TrimSpace(r.URL.Query().Get("name"))
	if dataName == "" || len([]rune(dataName)) > 200 {
		http.Error(w, "data name must be between 1 and 200 characters", http.StatusBadRequest)
		return
	}
	dataType := strings.TrimSpace(r.URL.Query().Get("dataType"))
	if !catalog.IsDataType(dataType) {
		http.Error(w, "invalid data type", http.StatusBadRequest)
		return
	}
	if r.ContentLength < 1 || r.ContentLength > s.maxUploadBytes {
		http.Error(w, "file size is missing or exceeds the upload limit", http.StatusRequestEntityTooLarge)
		return
	}
	select {
	case s.uploadSlots <- struct{}{}:
		defer func() { <-s.uploadSlots }()
	case <-r.Context().Done():
		http.Error(w, "upload canceled", http.StatusRequestTimeout)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.maxUploadBytes)
	id, err := newUUID()
	if err != nil {
		http.Error(w, "could not start upload", http.StatusInternalServerError)
		return
	}
	createdAt := time.Now().UTC()
	key := fmt.Sprintf("incoming/%s/%s/%s", createdAt.Format("2006/01"), id, fileName)
	hasher := sha256.New()
	body := io.TeeReader(r.Body, hasher)
	_, err = s.uploader.Upload(r.Context(), &s3.PutObjectInput{
		Bucket: aws.String(s.bucket), Key: aws.String(key), Body: body,
		ContentLength: aws.Int64(r.ContentLength), ContentType: aws.String("application/octet-stream"),
		Metadata: map[string]string{"upload-id": id, "source-file-name": fileName, "uploaded-at": createdAt.Format(time.RFC3339Nano)},
	})
	if err != nil {
		slog.Error("raw upload failed", "upload_id", id, "error", err)
		http.Error(w, "upload failed", http.StatusBadGateway)
		return
	}
	record := catalog.NewRawUpload{RawUpload: catalog.RawUpload{
		ID: id, Name: dataName, DataType: dataType, FileName: fileName, Format: format,
		ByteSize: r.ContentLength, SHA256: hex.EncodeToString(hasher.Sum(nil)), Status: "uploaded", CreatedAt: createdAt,
	}, ObjectKey: key}
	if subject, ok := r.Context().Value(actorContextKey{}).(string); ok {
		record.CreatedBy = subject
	}
	metadataCtx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	err = s.store.Create(metadataCtx, record)
	cancel()
	if err != nil {
		slog.Error("catalog write failed after raw upload", "upload_id", id, "error", err)
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		_, cleanupErr := s.objectStore.DeleteObject(cleanupCtx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
		cleanupCancel()
		if cleanupErr != nil {
			slog.Error("could not clean up untracked raw object", "upload_id", id, "error", cleanupErr)
		}
		http.Error(w, "could not register source data", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(record.RawUpload)
}

func (s *server) createConversionJob(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
	defer r.Body.Close()
	var request createConversionJobRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || !isUUID(request.RawUploadID) || request.MinZoom < 0 || request.MaxZoom > 24 || request.MinZoom > request.MaxZoom || len(request.LayerName) > 120 {
		http.Error(w, "invalid conversion request", http.StatusBadRequest)
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		http.Error(w, "invalid conversion request", http.StatusBadRequest)
		return
	}
	id, err := newUUID()
	if err != nil {
		http.Error(w, "could not create conversion job", http.StatusInternalServerError)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	job, err := s.store.CreateConversionJob(ctx, id, request.RawUploadID, request.MinZoom, request.MaxZoom, strings.TrimSpace(request.LayerName))
	if errors.Is(err, catalog.ErrRawUploadNotFound) || errors.Is(err, catalog.ErrConversionJobNotActive) {
		http.Error(w, "source data is not ready for conversion", http.StatusConflict)
		return
	}
	if err != nil {
		slog.Error("queue conversion job", "error", err)
		http.Error(w, "could not queue conversion job", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(conversionJobResponse{ID: job.ID, RawUploadID: job.RawUploadID, Status: job.Status, MinZoom: job.MinZoom, MaxZoom: job.MaxZoom, LayerName: job.LayerName, CreatedAt: job.CreatedAt})
}

func (s *server) cancelConversionJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("jobID")
	if !isUUID(id) {
		http.Error(w, "invalid conversion job identifier", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if err := s.store.CancelConversionJob(ctx, id); err != nil {
		switch {
		case errors.Is(err, catalog.ErrConversionJobNotFound):
			http.Error(w, "conversion job not found", http.StatusNotFound)
		case errors.Is(err, catalog.ErrConversionJobNotActive):
			http.Error(w, "conversion job is no longer active", http.StatusConflict)
		default:
			slog.Error("cancel conversion job", "job_id", id, "error", err)
			http.Error(w, "could not cancel conversion job", http.StatusServiceUnavailable)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) deleteConversionJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("jobID")
	if !isUUID(id) {
		http.Error(w, "invalid conversion job identifier", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	outputObjectKey, err := s.store.ConversionJobOutputKeyForDeletion(ctx, id)
	if err != nil {
		switch {
		case errors.Is(err, catalog.ErrConversionJobNotFound):
			http.Error(w, "conversion job not found", http.StatusNotFound)
		case errors.Is(err, catalog.ErrConversionJobNotRemovable):
			http.Error(w, "only finished conversion jobs may be removed", http.StatusConflict)
		default:
			slog.Error("read conversion output for deletion", "job_id", id, "error", err)
			http.Error(w, "could not delete conversion job", http.StatusServiceUnavailable)
		}
		return
	}
	if outputObjectKey != "" {
		if _, err := s.objectStore.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.derivedBucket), Key: aws.String(outputObjectKey)}); err != nil {
			slog.Error("delete converted output", "job_id", id, "error", err)
			http.Error(w, "could not delete converted data", http.StatusBadGateway)
			return
		}
	}
	if err := s.store.DeleteConversionJob(ctx, id); err != nil {
		switch {
		case errors.Is(err, catalog.ErrConversionJobNotFound):
			http.Error(w, "conversion job not found", http.StatusNotFound)
		case errors.Is(err, catalog.ErrConversionJobNotRemovable):
			http.Error(w, "only canceled or failed conversion jobs without output may be removed", http.StatusConflict)
		default:
			slog.Error("delete conversion job", "job_id", id, "error", err)
			http.Error(w, "could not delete conversion job", http.StatusServiceUnavailable)
		}
		return
	}
	if err := s.tileCache.Remove(id); err != nil && !errors.Is(err, os.ErrNotExist) {
		slog.Warn("remove converted artifact from tile cache", "job_id", id, "error", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) deleteUpload(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("uploadID")
	if !isUUID(id) {
		http.Error(w, "invalid source data identifier", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	objectKey, err := s.store.RawObjectKey(ctx, id)
	if errors.Is(err, catalog.ErrRawUploadNotFound) {
		http.Error(w, "source data not found", http.StatusNotFound)
		return
	}
	if err != nil {
		slog.Error("read raw upload metadata for deletion failed", "upload_id", id, "error", err)
		http.Error(w, "could not delete source data", http.StatusServiceUnavailable)
		return
	}
	if _, err := s.objectStore.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(objectKey)}); err != nil {
		slog.Error("delete raw object failed", "upload_id", id, "error", err)
		http.Error(w, "could not delete raw data", http.StatusBadGateway)
		return
	}
	if err := s.store.Delete(ctx, id); err != nil {
		slog.Error("delete raw upload metadata failed", "upload_id", id, "error", err)
		http.Error(w, "raw data was removed but catalog removal failed; retry deletion", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func isUUID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	_, err := hex.DecodeString(strings.ReplaceAll(value, "-", ""))
	return err == nil
}

func newUUID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	// RFC 4122 version 4 and variant 1 bits make the generated identifier
	// unambiguous to PostgreSQL and external tooling.
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s", hex.EncodeToString(bytes[:4]), hex.EncodeToString(bytes[4:6]), hex.EncodeToString(bytes[6:8]), hex.EncodeToString(bytes[8:10]), hex.EncodeToString(bytes[10:])), nil
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}
