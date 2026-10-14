# GeoData API (Go)

The API is written in Go. It reuses WebGIS as the identity authority: the UI
passes its Bearer access token and this service verifies it against the WebGIS
JWKS; it does not implement a second login, user store or password flow.

Required environment: `DATABASE_URL`, `GEODATA_AUTH_JWKS_URL`,
`GEODATA_AUTH_ISSUER`, and `GEODATA_AUTH_AUDIENCE`. Write operations require
claim `role: admin` or scope `geodata:admin`.

Run `go build ./cmd/geodata-api` in this directory. Apply the migration with a
PostgreSQL migration runner before deploying the API.
