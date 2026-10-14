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
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/golang-jwt/jwt/v5"
)

type uploadResponse struct {
	ID        string    `json:"id"`
	FileName  string    `json:"fileName"`
	ByteSize  int64     `json:"byteSize"`
	SHA256    string    `json:"sha256"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

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
	keys, err := keyfunc.NewDefaultCtx(ctx, []string{required("AUTH_JWKS_URL")})
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
	client := s3.NewFromConfig(base, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		o.UsePathStyle = true
	})
	uploader := manager.NewUploader(client, func(u *manager.Uploader) {
		u.PartSize = 64 * 1024 * 1024
		u.Concurrency = 2
	})
	app := &server{keys: keys, issuer: issuer, audience: audience, adminRole: roleName,
		bucket: required("S3_BUCKET"), maxUploadBytes: maxBytes, uploader: uploader, uploadSlots: make(chan struct{}, 2)}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
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

type server struct {
	keys                                keyfunc.Keyfunc
	issuer, audience, adminRole, bucket string
	maxUploadBytes                      int64
	uploader                            *manager.Uploader
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
			jwt.WithValidMethods([]string{"RS256", "ES256"}), jwt.WithIssuer(s.issuer), jwt.WithAudience(s.audience), jwt.WithExpirationRequired())
		if err != nil || token == nil || !token.Valid {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if !isAdmin(claims, s.adminRole) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
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

func (s *server) upload(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("filename")
	if name == "" || len(name) > 255 || filepath.Base(name) != name || strings.ContainsAny(name, "/\\\x00") {
		http.Error(w, "invalid file name", http.StatusBadRequest)
		return
	}
	ext := strings.ToLower(filepath.Ext(name))
	if ext == ".pbf" && !strings.HasSuffix(strings.ToLower(name), ".osm.pbf") {
		http.Error(w, "unsupported file format", http.StatusUnsupportedMediaType)
		return
	}
	valid := map[string]bool{".pbf": true, ".tif": true, ".tiff": true, ".gpkg": true, ".zip": true, ".mbtiles": true}
	if !valid[ext] || (ext == ".pbf" && !strings.HasSuffix(strings.ToLower(name), ".osm.pbf")) {
		http.Error(w, "unsupported file format", http.StatusUnsupportedMediaType)
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
	var idParts = []string{hex.EncodeToString(idBytes[:4]), hex.EncodeToString(idBytes[4:6]), hex.EncodeToString(idBytes[6:8]), hex.EncodeToString(idBytes[8:10]), hex.EncodeToString(idBytes[10:])}
	id := strings.Join(idParts, "-")
	key := fmt.Sprintf("incoming/%s/%s/%s", time.Now().UTC().Format("2006/01"), id, name)
	hasher := sha256.New()
	body := io.TeeReader(r.Body, hasher)
	_, err := s.uploader.Upload(r.Context(), &s3.PutObjectInput{
		Bucket: aws.String(s.bucket), Key: aws.String(key), Body: body,
		ContentLength: aws.Int64(r.ContentLength), ContentType: aws.String("application/octet-stream"),
		Metadata: map[string]string{"upload-id": id, "source-file-name": name, "uploaded-at": time.Now().UTC().Format(time.RFC3339Nano)},
	})
	if err != nil {
		slog.Error("raw upload failed", "upload_id", id, "error", err)
		http.Error(w, "upload failed", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(uploadResponse{ID: id, FileName: name, ByteSize: r.ContentLength,
		SHA256: hex.EncodeToString(hasher.Sum(nil)), Status: "uploaded", CreatedAt: time.Now().UTC()})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}
