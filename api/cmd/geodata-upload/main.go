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
)

type uploadListResponse struct {
	Items []catalog.RawUpload `json:"items"`
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
	app := &server{
		keys: keys, issuer: issuer, audience: audience, adminRole: roleName,
		bucket: required("S3_BUCKET"), maxUploadBytes: maxBytes, uploader: uploader,
		objectStore: objectStore, store: store, authJWKSURL: jwksURL,
		tileGatewayHealthURL: strings.TrimSpace(os.Getenv("TILE_GATEWAY_HEALTH_URL")),
		healthClient:         &http.Client{Timeout: 3 * time.Second},
		uploadSlots:          make(chan struct{}, 2),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.Handle("GET /api/geodata/v1/summary", app.requireAdmin(http.HandlerFunc(app.summary)))
	mux.Handle("GET /api/geodata/v1/uploads", app.requireAdmin(http.HandlerFunc(app.listUploads)))
	mux.Handle("PUT /api/geodata/v1/uploads", app.requireAdmin(http.HandlerFunc(app.upload)))
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
	keys                                keyfunc.Keyfunc
	issuer, audience, adminRole, bucket string
	maxUploadBytes                      int64
	uploader                            *manager.Uploader
	objectStore                         *s3.Client
	store                               *catalog.Store
	authJWKSURL, tileGatewayHealthURL   string
	healthClient                        *http.Client
	uploadSlots                         chan struct{}
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
		{Name: "catalog", State: s.checkCatalog(r.Context(), &response.Datasets)},
		{Name: "tiles", State: s.checkOptionalHTTPService(r.Context(), s.tileGatewayHealthURL)},
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
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
	_, err := s.objectStore.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)})
	if err != nil {
		slog.Warn("storage health check failed", "error", err)
		return serviceDegraded
	}
	return serviceReady
}

func (s *server) checkCatalog(parent context.Context, datasets *int) serviceState {
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
	*datasets = count
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
	idBytes := make([]byte, 16)
	if _, err := rand.Read(idBytes); err != nil {
		http.Error(w, "could not start upload", http.StatusInternalServerError)
		return
	}
	id := fmt.Sprintf("%s-%s-%s-%s-%s", hex.EncodeToString(idBytes[:4]), hex.EncodeToString(idBytes[4:6]), hex.EncodeToString(idBytes[6:8]), hex.EncodeToString(idBytes[8:10]), hex.EncodeToString(idBytes[10:]))
	createdAt := time.Now().UTC()
	key := fmt.Sprintf("incoming/%s/%s/%s", createdAt.Format("2006/01"), id, fileName)
	hasher := sha256.New()
	body := io.TeeReader(r.Body, hasher)
	_, err := s.uploader.Upload(r.Context(), &s3.PutObjectInput{
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

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}
