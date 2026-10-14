# GeoData ingestion and conversion services

`geodata-upload` validates a WebGIS JWT through its JWKS, requires an admin
role, streams `PUT /api/geodata/v1/uploads` requests to the private
`geodata-raw` bucket, and writes user-supplied catalog metadata to the dedicated
GeoData PostgreSQL database. It never returns the bucket, S3 endpoint, object
key, or S3 credentials.

`POST /api/geodata/v1/jobs` accepts a catalog `rawUploadId`, a zoom range and an
optional layer name. It queues work without exposing raw storage paths.
`geodata-worker` atomically claims each queued job, downloads the private source,
converts it to MBTiles, writes it to `geodata-derived`, then records the internal
artifact key and final status. It uses Tilemaker's built-in
OpenMapTiles-compatible schema for OSM PBF and GDAL for the other supported
formats.

Successful conversions are exposed to administrators as private artifacts:

- `GET /api/geodata/v1/artifacts` lists safe artifact metadata.
- `GET /api/geodata/v1/artifacts/{id}/tilejson` returns TileJSON.
- `GET /api/geodata/v1/artifacts/{id}/tiles/{z}/{x}/{y}` serves an MBTiles tile.

The API keeps a local, ephemeral MBTiles cache for preview. It downloads from
`geodata-derived` only after an authenticated request and never returns an S3
bucket, endpoint, credential, or object key.

## Map access grants

GeoData treats WebGIS as the identity authority. It has no users or groups
table of its own. When `WEBGIS_DIRECTORY_DATABASE_URL` is configured with the
least-privilege directory role, these admin-only endpoints use the active
WebGIS `users` directory:

- `GET /api/geodata/v1/access/subjects?type=user|organization&q=...` searches
  recipient choices. `organization` is the current WebGIS `users.organization`
  value; WebGIS does not currently expose a separate groups table.
- `GET /api/geodata/v1/access/grants` lists grants without exposing recipient
  UUIDs to the browser.
- `POST /api/geodata/v1/access/grants` creates one `view` or `export` grant
  for a release.
- `POST /api/geodata/v1/access/grants/{id}/revoke` immediately revokes it.

The tile gateway validates the same WebGIS JWT. A restricted release requires
an active grant matching the JWT `sub` or the account's current organisation.
Public and authenticated releases retain their existing behavior.

Required settings are documented in `deployment/README.md`. The service fails
closed if the WebGIS JWKS URL, issuer, or audience are missing. Confirm the
issuer/JWKS/audience values against the existing WebGIS token before deploying;
the UI's TypeScript auth response alone does not define those JWT claims.
