package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type contextKey string
const actorKey contextKey = "actor"

type actor struct { Subject string; Admin bool }
type server struct { db *pgxpool.Pool; keys keyfunc.Keyfunc; issuer, audience string }

func env(name string) string { v := os.Getenv(name); if v == "" { panic(name + " is required") }; return v }

func main() {
	ctx := context.Background()
	db, err := pgxpool.New(ctx, env("DATABASE_URL")); if err != nil { panic(err) }
	if err = db.Ping(ctx); err != nil { panic(err) }
	keys, err := keyfunc.NewDefaultCtx(ctx, []string{env("GEODATA_AUTH_JWKS_URL")}); if err != nil { panic(err) }
	s := &server{db: db, keys: keys, issuer: env("GEODATA_AUTH_ISSUER"), audience: env("GEODATA_AUTH_AUDIENCE")}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.Handle("GET /api/geodata/v1/summary", s.auth(http.HandlerFunc(s.summary)))
	mux.Handle("GET /api/geodata/v1/datasets", s.auth(http.HandlerFunc(s.listDatasets)))
	mux.Handle("POST /api/geodata/v1/datasets", s.auth(http.HandlerFunc(s.createDataset)))
	mux.Handle("GET /api/geodata/v1/datasets/{datasetId}", s.auth(http.HandlerFunc(s.getDataset)))
	mux.Handle("POST /api/geodata/v1/datasets/{datasetId}/versions", s.auth(http.HandlerFunc(s.createVersion)))
	port := os.Getenv("PORT"); if port == "" { port = "8090" }
	slog.Info("geodata API listening", "port", port)
	if err := http.ListenAndServe(":"+port, recoverer(mux)); err != nil { panic(err) }
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, map[string]string{"status": "ok"}) }

func (s *server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization"); if !strings.HasPrefix(h, "Bearer ") { problem(w, 401, "unauthenticated", "Missing bearer token"); return }
		token, err := jwt.Parse(h[7:], s.keys.Keyfunc, jwt.WithIssuer(s.issuer), jwt.WithAudience(s.audience), jwt.WithValidMethods([]string{"RS256", "ES256"}))
		if err != nil || !token.Valid { problem(w, 401, "unauthenticated", "Invalid bearer token"); return }
		claims, ok := token.Claims.(jwt.MapClaims); if !ok { problem(w, 401, "unauthenticated", "Invalid token claims"); return }
		sub, _ := claims.GetSubject(); if sub == "" { problem(w, 401, "unauthenticated", "Missing token subject"); return }
		admin := claims["role"] == "admin" || hasScope(claims["scope"], "geodata:admin")
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorKey, actor{Subject: sub, Admin: admin})))
	})
}

func hasScope(value any, wanted string) bool { s, ok := value.(string); return ok && strings.Contains(" "+s+" ", " "+wanted+" ") }
func requireAdmin(r *http.Request) bool { a, ok := r.Context().Value(actorKey).(actor); return ok && a.Admin }

func (s *server) summary(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) { problem(w, 403, "forbidden", "Administrator permission is required"); return }
	var datasets int
	if err := s.db.QueryRow(r.Context(), "SELECT count(*) FROM datasets WHERE status = 'active'").Scan(&datasets); err != nil { internal(w, err); return }
	writeJSON(w, 200, map[string]any{"datasets": datasets, "jobs": map[string]int{"queued":0,"running":0,"failed":0}, "releases":0, "services": []map[string]string{{"name":"authentication","state":"ready"},{"name":"storage","state":"unavailable"},{"name":"tiles","state":"unavailable"}}, "generatedAt":time.Now().UTC()})
}

func (s *server) listDatasets(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), "SELECT id, name, description, tags, status, created_at, updated_at FROM datasets WHERE status = COALESCE(NULLIF($1, ''), 'active') ORDER BY created_at DESC LIMIT 100", r.URL.Query().Get("status")); if err != nil { internal(w, err); return }; defer rows.Close()
	items := []map[string]any{}
	for rows.Next() { item, err := scanDataset(rows); if err != nil { internal(w, err); return }; items = append(items, item) }
	writeJSON(w, 200, map[string]any{"items":items,"page":map[string]any{"limit":100,"nextCursor":nil}})
}

func (s *server) createDataset(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) { problem(w, 403, "forbidden", "Administrator permission is required"); return }
	var in struct { Name string `json:"name"`; Description string `json:"description"`; Tags []string `json:"tags"` }; if err := decode(r, &in); err != nil { problem(w,400,"validation_failed",err.Error()); return }; if strings.TrimSpace(in.Name)=="" { problem(w,400,"validation_failed","name is required"); return }
	a := r.Context().Value(actorKey).(actor); tags, _ := json.Marshal(in.Tags)
	row := s.db.QueryRow(r.Context(), "INSERT INTO datasets (name,description,tags,created_by) VALUES ($1,$2,$3,$4) RETURNING id,name,description,tags,status,created_at,updated_at", strings.TrimSpace(in.Name), strings.TrimSpace(in.Description), tags, a.Subject)
	item, err := scanDataset(row); if err != nil { internal(w,err); return }; w.Header().Set("Location", "/api/geodata/v1/datasets/"+item["id"].(string)); writeJSON(w,201,item)
}

func (s *server) getDataset(w http.ResponseWriter, r *http.Request) {
	row := s.db.QueryRow(r.Context(), "SELECT id,name,description,tags,status,created_at,updated_at FROM datasets WHERE id=$1", r.PathValue("datasetId")); item, err := scanDataset(row); if errors.Is(err, pgx.ErrNoRows) { problem(w,404,"not_found","Dataset not found"); return }; if err != nil { internal(w,err); return }; writeJSON(w,200,item)
}

func (s *server) createVersion(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) { problem(w,403,"forbidden","Administrator permission is required"); return }
	var in struct { Version string `json:"version"`; Format string `json:"format"`; SourceFileName string `json:"sourceFileName"`; ByteSize int64 `json:"byteSize"`; ExpectedSHA256 string `json:"expectedSha256"`; SourceLicense string `json:"sourceLicense"` }; if err:=decode(r,&in); err!=nil { problem(w,400,"validation_failed",err.Error()); return }; if in.Version=="" || in.Format=="" || in.SourceFileName=="" || in.ByteSize<1 { problem(w,400,"validation_failed","version, format, sourceFileName and byteSize are required"); return }
	a:=r.Context().Value(actorKey).(actor)
	var id string; err:=s.db.QueryRow(r.Context(), "INSERT INTO dataset_versions (dataset_id,version,format,source_file_name,byte_size,expected_sha256,source_license,created_by) SELECT id,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),$8 FROM datasets WHERE id=$1 AND status='active' RETURNING id", r.PathValue("datasetId"),in.Version,in.Format,in.SourceFileName,in.ByteSize,in.ExpectedSHA256,in.SourceLicense,a.Subject).Scan(&id)
	if err!=nil { problem(w,409,"version_create_failed","Dataset is inactive, absent, or version already exists"); return }; writeJSON(w,201,map[string]any{"id":id,"datasetId":r.PathValue("datasetId"),"version":in.Version,"format":in.Format,"status":"awaiting_upload","byteSize":in.ByteSize,"createdAt":time.Now().UTC()})
}

type scanner interface { Scan(...any) error }
func scanDataset(row scanner) (map[string]any,error) { var id,name,description,status string; var tags []byte; var created,updated time.Time; err:=row.Scan(&id,&name,&description,&tags,&status,&created,&updated); if err!=nil{return nil,err}; var parsed []string; _=json.Unmarshal(tags,&parsed); return map[string]any{"id":id,"name":name,"description":description,"tags":parsed,"status":status,"createdAt":created,"updatedAt":updated},nil }
func decode(r *http.Request, v any) error { defer r.Body.Close(); d:=json.NewDecoder(http.MaxBytesReader(nil,r.Body,1<<20)); d.DisallowUnknownFields(); return d.Decode(v) }
func writeJSON(w http.ResponseWriter,status int,v any){w.Header().Set("Content-Type","application/json");w.WriteHeader(status);_ = json.NewEncoder(w).Encode(v)}
func problem(w http.ResponseWriter,status int,code,title string){w.Header().Set("Content-Type","application/problem+json");w.WriteHeader(status);_ = json.NewEncoder(w).Encode(map[string]any{"type":"https://geodata.invalid/problems/"+code,"title":title,"status":status,"code":code})}
func internal(w http.ResponseWriter,err error){slog.Error("request failed","error",err);problem(w,500,"internal_error","Internal server error")}
func recoverer(next http.Handler) http.Handler{return http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){defer func(){if v:=recover();v!=nil{internal(w,errors.New("panic"))}}();next.ServeHTTP(w,r)})}
