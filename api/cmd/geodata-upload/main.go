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
	"github.com/nvlhuongnoi2005/ms-geodata/api/internal/directory"
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
	Name           string   `json:"name"`
	MapCode        string   `json:"mapCode"`
	Version        string   `json:"version"`
	Description    string   `json:"description"`
	ReleaseNotes   string   `json:"releaseNotes"`
	ArtifactIDs    []string `json:"artifactIds"`
	StyleVersionID string   `json:"styleVersionId"`
}
type releaseListResponse struct {
	Items []catalog.MapRelease `json:"items"`
}
type styleListResponse struct {
	Items []catalog.StyleVersion `json:"items"`
}

type directorySubjectListResponse struct {
	Items []directory.Subject `json:"items"`
}

type accessGrantListResponse struct {
	Items []catalog.AccessGrant `json:"items"`
}

type createAccessGrantRequest struct {
	PrincipalType string `json:"principalType"`
	PrincipalID   string `json:"principalId"`
	ReleaseID     string `json:"releaseId"`
	Scope         string `json:"scope"`
	Note          string `json:"note"`
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
	var webgisDirectory *directory.Directory
	if dsn := strings.TrimSpace(os.Getenv("WEBGIS_DIRECTORY_DATABASE_URL")); dsn != "" {
		openCtx, openCancel := context.WithTimeout(ctx, 10*time.Second)
		openedDirectory, directoryErr := directory.Open(openCtx, dsn)
		openCancel()
		if directoryErr != nil {
			log.Fatalf("connect WebGIS identity directory: %v", directoryErr)
		}
		webgisDirectory = openedDirectory
		defer webgisDirectory.Close()
	} else {
		slog.Warn("WebGIS identity directory is not configured; access management is unavailable")
	}

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
		// Multipart buffers are held in the API process. One 64 MiB part for
		// each of two concurrent transfers caused the 512 MiB single-node pod
		// to be OOM-killed when importing a country-scale MBTiles file.
		// 16 MiB / one part keeps the API streaming and leaves headroom for the
		// S3 client, JWT verifier and concurrent health probes.
		u.PartSize = 16 * 1024 * 1024
		u.Concurrency = 1
	})
	app := &server{
		keys: keys, issuer: issuer, audience: audience, adminRole: roleName,
		bucket: required("S3_BUCKET"), derivedBucket: required("S3_DERIVED_BUCKET"), maxUploadBytes: maxBytes, uploader: uploader,
		objectStore: objectStore, store: store, authJWKSURL: jwksURL,
		tileGatewayHealthURL: strings.TrimSpace(os.Getenv("TILE_GATEWAY_HEALTH_URL")),
		healthClient:         &http.Client{Timeout: 3 * time.Second},
		uploadSlots:          make(chan struct{}, 1),
		directory:            webgisDirectory,
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
	mux.Handle("PUT /api/geodata/v1/artifacts/import", app.requireAdmin(http.HandlerFunc(app.importMBTiles)))
	mux.Handle("GET /api/geodata/v1/styles", app.requireAdmin(http.HandlerFunc(app.listStyleVersions)))
	mux.Handle("POST /api/geodata/v1/styles/import", app.requireAdmin(http.HandlerFunc(app.importStyleVersion)))
	mux.Handle("GET /api/geodata/v1/releases", app.requireAdmin(http.HandlerFunc(app.listReleases)))
	mux.Handle("POST /api/geodata/v1/releases", app.requireAdmin(http.HandlerFunc(app.createRelease)))
	mux.Handle("POST /api/geodata/v1/releases/{releaseID}/publish", app.requireAdmin(http.HandlerFunc(app.publishRelease)))
	mux.Handle("POST /api/geodata/v1/releases/{releaseID}/unpublish", app.requireAdmin(http.HandlerFunc(app.unpublishRelease)))
	mux.Handle("DELETE /api/geodata/v1/releases/{releaseID}", app.requireAdmin(http.HandlerFunc(app.deleteRelease)))
	mux.Handle("GET /api/geodata/v1/access/subjects", app.requireAdmin(http.HandlerFunc(app.listDirectorySubjects)))
	mux.Handle("GET /api/geodata/v1/access/grants", app.requireAdmin(http.HandlerFunc(app.listAccessGrants)))
	mux.Handle("POST /api/geodata/v1/access/grants", app.requireAdmin(http.HandlerFunc(app.createAccessGrant)))
	mux.Handle("POST /api/geodata/v1/access/grants/{grantID}/revoke", app.requireAdmin(http.HandlerFunc(app.revokeAccessGrant)))
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
	authJWKSURL, tileGatewayHealthURL                  string
	healthClient                                       *http.Client
	uploadSlots                                        chan struct{}
	directory                                          *directory.Directory
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

func (s *server) listStyleVersions(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	items, err := s.store.ListStyleVersions(ctx, 100)
	if err != nil {
		http.Error(w, "could not load style versions", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(styleListResponse{Items: items})
}

// importStyleVersion accepts an immutable MapLibre document plus the sprite
// atlas files belonging to it. S3 paths are generated by the server and are
// never returned; public reads happen only via the tile gateway.
func (s *server) importStyleVersion(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
	if err := r.ParseMultipartForm(12 << 20); err != nil {
		http.Error(w, "style bundle is invalid or too large", http.StatusRequestEntityTooLarge)
		return
	}
	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" || len([]rune(name)) > 200 {
		http.Error(w, "style name must be between 1 and 200 characters", http.StatusBadRequest)
		return
	}
	styleFile, _, err := r.FormFile("style")
	if err != nil {
		http.Error(w, "style.json is required", http.StatusBadRequest)
		return
	}
	defer styleFile.Close()
	document, err := io.ReadAll(io.LimitReader(styleFile, 2<<20))
	if err != nil || !validMapLibreStyle(document) {
		http.Error(w, "style must be a valid MapLibre Style Specification v8 document", http.StatusBadRequest)
		return
	}
	styleID, err := newUUID()
	if err != nil {
		http.Error(w, "could not create style version", http.StatusInternalServerError)
		return
	}
	createdAt := time.Now().UTC()
	keys := []string{fmt.Sprintf("styles/%s/style.json", styleID)}
	put := func(key, contentType string, body io.Reader, length int64) error {
		_, uploadErr := s.uploader.Upload(r.Context(), &s3.PutObjectInput{
			Bucket: aws.String(s.derivedBucket), Key: aws.String(key), Body: body,
			ContentLength: aws.Int64(length), ContentType: aws.String(contentType),
			Metadata: map[string]string{"style-id": styleID, "created-at": createdAt.Format(time.RFC3339Nano)},
		})
		return uploadErr
	}
	if err = put(keys[0], "application/json", strings.NewReader(string(document)), int64(len(document))); err != nil {
		slog.Error("store style document", "style_id", styleID, "error", err)
		http.Error(w, "could not store style", http.StatusBadGateway)
		return
	}
	hasSprite, uploadErr := s.storeSpritePair(r, "spriteJson", "spritePng", "", styleID, put, &keys)
	hasSprite2x := false
	if uploadErr == nil {
		hasSprite2x, uploadErr = s.storeSpritePair(r, "spriteJson2x", "spritePng2x", "@2x", styleID, put, &keys)
	}
	if uploadErr == nil && hasSprite2x && !hasSprite {
		uploadErr = errors.New("sprite@2x requires the base sprite.json and sprite.png files")
	}
	if uploadErr != nil {
		s.cleanupStyleObjects(keys)
		http.Error(w, uploadErr.Error(), http.StatusBadRequest)
		return
	}
	actor, _ := r.Context().Value(actorContextKey{}).(string)
	style := catalog.StyleVersion{ID: styleID, Name: name, Document: json.RawMessage(document), HasSprite: hasSprite, HasGlyphs: false, CreatedAt: createdAt}
	if err = s.store.CreateStyleVersion(r.Context(), style, actor); err != nil {
		s.cleanupStyleObjects(keys)
		slog.Error("register style version", "style_id", styleID, "error", err)
		http.Error(w, "could not save style version", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(style)
}

func (s *server) storeSpritePair(r *http.Request, jsonField, pngField, suffix, styleID string, put func(string, string, io.Reader, int64) error, keys *[]string) (bool, error) {
	jsonFile, jsonHeader, jsonErr := r.FormFile(jsonField)
	pngFile, pngHeader, pngErr := r.FormFile(pngField)
	if errors.Is(jsonErr, http.ErrMissingFile) && errors.Is(pngErr, http.ErrMissingFile) {
		return false, nil
	}
	if jsonErr != nil || pngErr != nil {
		return false, fmt.Errorf("sprite %s requires both JSON and PNG files", strings.TrimPrefix(suffix, "@"))
	}
	defer jsonFile.Close()
	defer pngFile.Close()
	if jsonHeader.Size < 1 || jsonHeader.Size > 2<<20 || pngHeader.Size < 1 || pngHeader.Size > 12<<20 {
		return false, fmt.Errorf("sprite %s files are outside allowed size", strings.TrimPrefix(suffix, "@"))
	}
	index, err := io.ReadAll(io.LimitReader(jsonFile, 2<<20))
	if err != nil || !json.Valid(index) {
		return false, fmt.Errorf("sprite %s JSON is invalid", strings.TrimPrefix(suffix, "@"))
	}
	base := fmt.Sprintf("styles/%s/sprite%s", styleID, suffix)
	if err := put(base+".json", "application/json", strings.NewReader(string(index)), int64(len(index))); err != nil {
		return false, fmt.Errorf("could not store sprite JSON")
	}
	*keys = append(*keys, base+".json")
	if err := put(base+".png", "image/png", pngFile, pngHeader.Size); err != nil {
		return false, fmt.Errorf("could not store sprite PNG")
	}
	*keys = append(*keys, base+".png")
	return true, nil
}

func (s *server) cleanupStyleObjects(keys []string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	for _, key := range keys {
		_, _ = s.objectStore.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.derivedBucket), Key: aws.String(key)})
	}
}

func validMapLibreStyle(document []byte) bool {
	var style struct {
		Version float64        `json:"version"`
		Sources map[string]any `json:"sources"`
		Layers  []any          `json:"layers"`
	}
	return json.Unmarshal(document, &style) == nil && style.Version == 8 && len(style.Sources) > 0 && len(style.Layers) > 0
}

func (s *server) createRelease(w http.ResponseWriter, r *http.Request) {
	var request createReleaseRequest
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	defer r.Body.Close()
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if d.Decode(&request) != nil || strings.TrimSpace(request.Name) == "" || !validVersion(request.Version) || len(request.Description) > 2000 || len(request.ReleaseNotes) > 4000 || len(request.ArtifactIDs) == 0 || len(request.ArtifactIDs) > 20 {
		http.Error(w, "invalid release request", 400)
		return
	}
	for _, id := range request.ArtifactIDs {
		if !isUUID(id) {
			http.Error(w, "invalid artifact", 400)
			return
		}
	}
	if request.StyleVersionID != "" && !isUUID(request.StyleVersionID) {
		http.Error(w, "invalid style version", http.StatusBadRequest)
		return
	}
	mapCode := strings.TrimSpace(request.MapCode)
	ctx, c := context.WithTimeout(r.Context(), 10*time.Second)
	defer c()
	if mapCode == "" {
		var err error
		mapCode, err = newMapCode()
		if err != nil {
			http.Error(w, "could not generate map code", http.StatusInternalServerError)
			return
		}
	} else {
		if !validMapCode(mapCode) {
			http.Error(w, "invalid map code", http.StatusBadRequest)
			return
		}
		exists, err := s.store.MapCodeExists(ctx, mapCode)
		if err != nil {
			http.Error(w, "could not verify map version", http.StatusServiceUnavailable)
			return
		}
		if !exists {
			http.Error(w, "map code must refer to an existing map", http.StatusBadRequest)
			return
		}
	}
	slug := releaseSlug(mapCode, request.Version)
	if !validSlug(slug) {
		http.Error(w, "generated release identifier is invalid", http.StatusBadRequest)
		return
	}
	id, err := newUUID()
	if err != nil {
		http.Error(w, "could not create release", 500)
		return
	}
	actor, _ := r.Context().Value(actorContextKey{}).(string)
	// Access policy is selected later in Access control. A newly drafted map is
	// restricted until an administrator makes it public or grants recipients.
	release := catalog.MapRelease{ID: id, Name: strings.TrimSpace(request.Name), MapCode: mapCode, Version: request.Version, Slug: slug, Description: strings.TrimSpace(request.Description), ReleaseNotes: strings.TrimSpace(request.ReleaseNotes), Visibility: "restricted", Status: "draft", StyleVersionID: request.StyleVersionID, CreatedBy: actor, CreatedAt: time.Now().UTC()}
	if err = s.store.CreateRelease(ctx, release, request.ArtifactIDs); err != nil {
		if errors.Is(err, catalog.ErrConversionJobNotActive) {
			http.Error(w, "the selected MBTiles output is not ready in GeoData tile storage", http.StatusConflict)
			return
		}
		// Keep database implementation details out of the browser, but retain
		// the complete error in the server log for an operator to diagnose.
		slog.Error("create map release", "map_code", mapCode, "version", request.Version, "artifact_count", len(request.ArtifactIDs), "error", err)
		if strings.Contains(err.Error(), "duplicate key") {
			http.Error(w, "a release with this map code and version already exists", http.StatusConflict)
			return
		}
		http.Error(w, "could not save the draft release", http.StatusServiceUnavailable)
		return
	}
	release.ArtifactIDs = request.ArtifactIDs
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
		// Do not turn database or infrastructure failures into a misleading
		// lifecycle error. The draft remains unchanged when publishing fails.
		slog.Error("publish map release", "release_id", id, "error", err)
		if errors.Is(err, catalog.ErrReleaseArtifactsNotReady) {
			http.Error(w, "MBTiles is still being prepared for GeoData serving", http.StatusConflict)
			return
		}
		if errors.Is(err, catalog.ErrConversionJobNotFound) || errors.Is(err, catalog.ErrConversionJobNotActive) {
			http.Error(w, "this release can no longer be published", http.StatusConflict)
			return
		}
		http.Error(w, "could not publish the release right now", http.StatusServiceUnavailable)
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

func (s *server) requireDirectory(w http.ResponseWriter) bool {
	if s.directory != nil {
		return true
	}
	http.Error(w, "WebGIS identity directory is not configured", http.StatusServiceUnavailable)
	return false
}

func directoryType(raw string) (string, bool) {
	switch raw {
	case directory.SubjectUser:
		return directory.SubjectUser, true
	case directory.SubjectOrganization, "group":
		return directory.SubjectOrganization, true
	default:
		return "", false
	}
}

func (s *server) listDirectorySubjects(w http.ResponseWriter, r *http.Request) {
	if !s.requireDirectory(w) {
		return
	}
	kind, ok := directoryType(strings.TrimSpace(r.URL.Query().Get("type")))
	if !ok {
		http.Error(w, "type must be user or organization", http.StatusBadRequest)
		return
	}
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			http.Error(w, "limit must be between 1 and 100", http.StatusBadRequest)
			return
		}
		limit = value
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	items, err := s.directory.Search(ctx, kind, r.URL.Query().Get("q"), limit)
	if err != nil {
		slog.Error("search WebGIS directory", "error", err)
		http.Error(w, "could not search WebGIS users", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(directorySubjectListResponse{Items: items})
}

func (s *server) listAccessGrants(w http.ResponseWriter, r *http.Request) {
	kind := ""
	if raw := strings.TrimSpace(r.URL.Query().Get("principalType")); raw != "" {
		if raw != "public" {
			var ok bool
			kind, ok = directoryType(raw)
			if !ok {
				http.Error(w, "principalType must be public, user, or organization", http.StatusBadRequest)
				return
			}
		} else {
			kind = "public"
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	items, err := s.store.ListAccessGrants(ctx, kind, 100)
	if err != nil {
		slog.Error("list access grants", "error", err)
		http.Error(w, "could not load access grants", http.StatusServiceUnavailable)
		return
	}
	for index := range items {
		if items[index].PrincipalType == "public" {
			items[index].SubjectName = "Public"
			continue
		}
		if s.directory == nil {
			items[index].SubjectName = "Directory unavailable"
			continue
		}
		subject, subjectErr := s.directory.Subject(ctx, items[index].PrincipalType, items[index].PrincipalID)
		if subjectErr == nil {
			items[index].SubjectName = subject.Name
			items[index].Organization = subject.Organization
		} else if errors.Is(subjectErr, directory.ErrNotFound) {
			items[index].SubjectName = "Unavailable account"
		} else {
			slog.Warn("resolve access grant directory subject", "grant_id", items[index].ID, "error", subjectErr)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(accessGrantListResponse{Items: items})
}

func (s *server) createAccessGrant(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
	defer r.Body.Close()
	var request createAccessGrantRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || decoder.Decode(&struct{}{}) != io.EOF {
		http.Error(w, "invalid access grant request", http.StatusBadRequest)
		return
	}
	kind := strings.TrimSpace(request.PrincipalType)
	if !isUUID(strings.TrimSpace(request.ReleaseID)) || (request.Scope != "view" && request.Scope != "export") || len(request.Note) > 2000 {
		http.Error(w, "invalid access grant request", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	actor, _ := r.Context().Value(actorContextKey{}).(string)
	grantInput := catalog.AccessGrant{PrincipalType: kind, ReleaseID: request.ReleaseID, Scope: request.Scope, Note: strings.TrimSpace(request.Note), CreatedBy: actor}
	var subject directory.Subject
	if kind == "public" {
		grantInput.PrincipalID = "*"
		grantInput.Scope = "view"
	} else {
		resolvedKind, ok := directoryType(kind)
		if !ok || !s.requireDirectory(w) {
			if !ok {
				http.Error(w, "principalType must be public, user, or organization", http.StatusBadRequest)
			}
			return
		}
		kind = resolvedKind
		grantInput.PrincipalType = kind
		var err error
		subject, err = s.directory.Subject(ctx, kind, request.PrincipalID)
		if errors.Is(err, directory.ErrNotFound) {
			http.Error(w, "WebGIS user or organization is unavailable", http.StatusBadRequest)
			return
		}
		if err != nil {
			slog.Error("verify WebGIS directory subject", "error", err)
			http.Error(w, "could not verify WebGIS identity", http.StatusServiceUnavailable)
			return
		}
		grantInput.PrincipalID = subject.ID
	}
	grant, err := s.store.CreateAccessGrant(ctx, grantInput)
	if errors.Is(err, catalog.ErrAccessGrantNotFound) {
		http.Error(w, "release does not exist or this access grant already exists", http.StatusConflict)
		return
	}
	if err != nil {
		slog.Error("create access grant", "error", err)
		http.Error(w, "could not create access grant", http.StatusServiceUnavailable)
		return
	}
	if grant.PrincipalType == "public" {
		grant.SubjectName = "Public"
	} else {
		grant.SubjectName, grant.Organization = subject.Name, subject.Organization
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(grant)
}

func (s *server) revokeAccessGrant(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("grantID")
	if !isUUID(id) {
		http.Error(w, "invalid access grant identifier", http.StatusBadRequest)
		return
	}
	actor, _ := r.Context().Value(actorContextKey{}).(string)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if err := s.store.RevokeAccessGrant(ctx, id, actor); err != nil {
		if errors.Is(err, catalog.ErrAccessGrantNotFound) {
			http.Error(w, "access grant not found or already revoked", http.StatusNotFound)
			return
		}
		slog.Error("revoke access grant", "error", err)
		http.Error(w, "could not revoke access grant", http.StatusServiceUnavailable)
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

func validMapCode(value string) bool {
	// Legacy releases use their former slug as mapCode. Keep those maps
	// versionable even when an old identifier is shorter than new generated
	// codes such as map-a1b2c3d4e5f6.
	return validSlug(value) && len(value) <= 100
}

func validVersion(value string) bool {
	parts := strings.Split(value, ".")
	if len(parts) != 3 || len(value) > 32 {
		return false
	}
	for _, part := range parts {
		if part == "" || (len(part) > 1 && part[0] == '0') {
			return false
		}
		if _, err := strconv.Atoi(part); err != nil {
			return false
		}
	}
	return true
}

func newMapCode() (string, error) {
	id, err := newUUID()
	if err != nil {
		return "", err
	}
	return "map-" + strings.ReplaceAll(id, "-", "")[:12], nil
}

func releaseSlug(mapCode, version string) string {
	return mapCode + "-v" + strings.ReplaceAll(version, ".", "-")
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

// importMBTiles accepts a pre-built MBTiles file from the release workspace.
// The original remains in raw storage for provenance and an immutable copy is
// placed in derived storage for the GeoData serving-store warmer. No tiling or
// conversion job is queued.
func (s *server) importMBTiles(w http.ResponseWriter, r *http.Request) {
	fileName := r.URL.Query().Get("filename")
	if fileName == "" || len(fileName) > 255 || filepath.Base(fileName) != fileName || strings.ContainsAny(fileName, "/\\\x00") {
		http.Error(w, "invalid file name", http.StatusBadRequest)
		return
	}
	format, supported := catalog.SourceFormat(fileName)
	if !supported || format != "mbtiles" {
		http.Error(w, "only MBTiles files can be imported here", http.StatusUnsupportedMediaType)
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
	rawID, err := newUUID()
	if err != nil {
		http.Error(w, "could not start MBTiles import", http.StatusInternalServerError)
		return
	}
	artifactID, err := newUUID()
	if err != nil {
		http.Error(w, "could not start MBTiles import", http.StatusInternalServerError)
		return
	}
	createdAt := time.Now().UTC()
	rawKey := fmt.Sprintf("incoming/%s/%s/%s", createdAt.Format("2006/01"), rawID, fileName)
	artifactKey := fmt.Sprintf("artifacts/imports/%s.mbtiles", artifactID)
	hasher := sha256.New()
	_, err = s.uploader.Upload(r.Context(), &s3.PutObjectInput{
		Bucket: aws.String(s.bucket), Key: aws.String(rawKey), Body: io.TeeReader(r.Body, hasher),
		ContentLength: aws.Int64(r.ContentLength), ContentType: aws.String("application/x-sqlite3"),
		Metadata: map[string]string{"upload-id": rawID, "source-file-name": fileName, "imported-at": createdAt.Format(time.RFC3339Nano)},
	})
	if err != nil {
		slog.Error("upload imported MBTiles source", "artifact_id", artifactID, "error", err)
		http.Error(w, "MBTiles upload failed", http.StatusBadGateway)
		return
	}
	source, err := s.objectStore.GetObject(r.Context(), &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(rawKey)})
	if err == nil {
		defer source.Body.Close()
		_, err = s.uploader.Upload(r.Context(), &s3.PutObjectInput{
			Bucket: aws.String(s.derivedBucket), Key: aws.String(artifactKey), Body: source.Body,
			ContentLength: source.ContentLength, ContentType: aws.String("application/x-sqlite3"), Metadata: map[string]string{"format": "mbtiles", "source": "direct-import"},
		})
	}
	if err != nil {
		slog.Error("store imported MBTiles artifact", "artifact_id", artifactID, "error", err)
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		_, _ = s.objectStore.DeleteObject(cleanupCtx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(rawKey)})
		cancel()
		http.Error(w, "could not register MBTiles in derived storage", http.StatusBadGateway)
		return
	}
	record := catalog.NewRawUpload{RawUpload: catalog.RawUpload{
		ID: rawID, Name: dataName, DataType: dataType, FileName: fileName, Format: "mbtiles",
		ByteSize: r.ContentLength, SHA256: hex.EncodeToString(hasher.Sum(nil)), Status: "converted", CreatedAt: createdAt,
	}, ObjectKey: rawKey}
	if subject, ok := r.Context().Value(actorContextKey{}).(string); ok {
		record.CreatedBy = subject
	}
	metadataCtx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	err = s.store.CreateImportedMBTiles(metadataCtx, record, artifactID, artifactKey)
	cancel()
	if err != nil {
		slog.Error("register imported MBTiles", "artifact_id", artifactID, "error", err)
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 20*time.Second)
		_, _ = s.objectStore.DeleteObject(cleanupCtx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(rawKey)})
		_, _ = s.objectStore.DeleteObject(cleanupCtx, &s3.DeleteObjectInput{Bucket: aws.String(s.derivedBucket), Key: aws.String(artifactKey)})
		cleanupCancel()
		http.Error(w, "could not register imported MBTiles", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(catalog.ConversionArtifactView{
		ID: artifactID, SourceName: dataName, OutputFormat: "mbtiles", CacheStatus: "pending", CreatedAt: createdAt,
	})
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
