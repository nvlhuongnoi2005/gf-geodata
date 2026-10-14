# Geodata raw upload API

The service accepts a single `PUT /api/geodata/v1/uploads?filename=...` request,
validates a WebGIS JWT through its JWKS, requires an admin role, and streams the
request body to the private `geodata-raw` S3 bucket. It never returns the bucket,
S3 endpoint, object key, or S3 credentials. Uploads are multipart-streamed to
SeaweedFS; this service does not yet create dataset catalog rows or run a data
conversion pipeline.

Required settings are documented in `deployment/README.md`. The service fails
closed if the WebGIS JWKS URL, issuer, or audience are missing. Confirm the
issuer/JWKS/audience values against the existing WebGIS token before deploying;
the UI's TypeScript auth response alone does not define those JWT claims.
