# GeoData UI deployment

The UI is deployed in `tile-server` and reuses WebGIS authentication through
the `/auth` reverse proxy. Raw files are uploaded through the authenticated Go
API and stored privately in SeaweedFS in the separate `storage` namespace. The
browser never receives an S3 URL, object key, bucket name, or S3 credential.

## Configure credentials once

Before applying `deployment`, create the Secrets referenced by the manifests.
Do not commit these credentials. Run this PowerShell in the repository root;
it creates random S3 credentials and applies Kubernetes Secrets without writing
them to a file. Keep the resulting values in your password manager for rotation.

```powershell
kubectl apply -f deployment/namespace.yaml
kubectl create namespace storage --dry-run=client -o yaml | kubectl apply -f -

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $adminKeyBytes = New-Object byte[] 10
  $adminSecretBytes = New-Object byte[] 32
  $uploadKeyBytes = New-Object byte[] 10
  $uploadSecretBytes = New-Object byte[] 32
  $workerKeyBytes = New-Object byte[] 10
  $workerSecretBytes = New-Object byte[] 32
  $rng.GetBytes($adminKeyBytes)
  $rng.GetBytes($adminSecretBytes)
  $rng.GetBytes($uploadKeyBytes)
  $rng.GetBytes($uploadSecretBytes)
  $rng.GetBytes($workerKeyBytes)
  $rng.GetBytes($workerSecretBytes)
} finally {
  $rng.Dispose()
}
$adminKey = [BitConverter]::ToString($adminKeyBytes).Replace('-', '')
$adminSecret = [Convert]::ToBase64String($adminSecretBytes)
$uploadKey = [BitConverter]::ToString($uploadKeyBytes).Replace('-', '')
$uploadSecret = [Convert]::ToBase64String($uploadSecretBytes)
$workerKey = [BitConverter]::ToString($workerKeyBytes).Replace('-', '')
$workerSecret = [Convert]::ToBase64String($workerSecretBytes)
if ([string]::IsNullOrWhiteSpace($adminKey) -or [string]::IsNullOrWhiteSpace($adminSecret) -or [string]::IsNullOrWhiteSpace($uploadKey) -or [string]::IsNullOrWhiteSpace($uploadSecret) -or [string]::IsNullOrWhiteSpace($workerKey) -or [string]::IsNullOrWhiteSpace($workerSecret)) {
  throw 'Generated S3 credential is empty; no Secret was created.'
}
$config = @{
  identities = @(
    @{ name = 'bootstrap-admin'; credentials = @(@{ accessKey = $adminKey; secretKey = $adminSecret }); actions = @('Admin','Read','Write','List','Tagging') },
    @{ name = 'geodata-upload'; credentials = @(@{ accessKey = $uploadKey; secretKey = $uploadSecret }); actions = @('Read','Write','List'); resources = @('buckets/geodata-raw/','buckets/geodata-derived/') },
    @{ name = 'geodata-worker'; credentials = @(@{ accessKey = $workerKey; secretKey = $workerSecret }); actions = @('Read','Write','List'); resources = @('buckets/geodata-raw/','buckets/geodata-derived/') }
  )
} | ConvertTo-Json -Depth 8 -Compress

$s3ConfigFile = New-TemporaryFile
try {
  [System.IO.File]::WriteAllText($s3ConfigFile.FullName, $config, (New-Object System.Text.UTF8Encoding($false)))
  kubectl -n storage create secret generic geodata-seaweed-s3-config --from-file="s3.json=$($s3ConfigFile.FullName)" --dry-run=client -o yaml | kubectl apply -f -
} finally {
  Remove-Item -LiteralPath $s3ConfigFile.FullName -Force
}
kubectl -n storage create secret generic geodata-s3-bootstrap --from-literal="access-key=$adminKey" --from-literal="secret-key=$adminSecret" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n tile-server create secret generic geodata-upload-s3 --from-literal="access-key=$uploadKey" --from-literal="secret-key=$uploadSecret" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n tile-server create secret generic geodata-worker-s3 --from-literal="access-key=$workerKey" --from-literal="secret-key=$workerSecret" --dry-run=client -o yaml | kubectl apply -f -

$bootstrapSecret = kubectl -n storage get secret geodata-s3-bootstrap -o json | ConvertFrom-Json
if ($bootstrapSecret.data.'access-key'.Length -eq 0 -or $bootstrapSecret.data.'secret-key'.Length -eq 0) {
  throw 'Bootstrap Secret contains an empty key; stop and recreate it before deploying.'
}
```

If an S3 credential Secret was accidentally created with blank values, use
the checked script below. It safely rotates all application identities together and stops
if the bootstrap Secret is empty; it never prints credential values. Then
restart SeaweedFS and recreate the bootstrap Job:

```powershell
& .\deployment\scripts\rotate-geodata-s3-credentials.ps1
kubectl -n storage rollout restart statefulset/seaweedfs
kubectl -n storage rollout status statefulset/seaweedfs --timeout=10m
kubectl -n storage delete job geodata-bucket-bootstrap --ignore-not-found
kubectl apply -k deployment/storage
kubectl -n storage wait --for=condition=complete job/geodata-bucket-bootstrap --timeout=5m
```

The existing `gf-webgis` controller is the identity authority. Its JWTs are
signed with EdDSA and expose JWKS at `/auth/.well-known/jwks.json`. The upload
API validates the same `iss`, `aud`, expiration and admin role claim as WebGIS;
it does not create or manage a second login system.

Confirm the live config values without reading any private key:

```powershell
$webgisConfig = kubectl -n webgis get configmap webgis-config -o json | ConvertFrom-Json
$webgisConfig.data.AUTH_JWT_ISSUER
$webgisConfig.data.AUTH_JWT_AUDIENCE
kubectl -n webgis get service controller
```

For the current `gf-webgis` deployment, use its in-cluster Service address and
the values configured in `webgis-config`:

```powershell
$jwksUrl = 'http://controller.webgis.svc.cluster.local:3001/auth/.well-known/jwks.json'
$issuer = 'auth-service'
$audience = 'api-gateway'
kubectl -n tile-server create secret generic geodata-upload-auth --from-literal="jwks-url=$jwksUrl" --from-literal="issuer=$issuer" --from-literal="audience=$audience" --dry-run=client -o yaml | kubectl apply -f -
```

## Connect WebGIS users and organisations for map permissions

GeoData does **not** copy WebGIS users. It reads only the active user directory
from the existing `webgis.users` table and stores grants by WebGIS user UUID or
by the existing `users.organization` value. The current WebGIS schema does not
have a separate groups table; therefore “organisation” is the supported unit
principal until WebGIS introduces stable organisation IDs.

Create a database role with the minimum possible permission, then create the
GeoData Secret. This runs against the WebGIS database and does not expose or
reuse the `webgis_auth` password in GeoData:

```powershell
$directoryPassword = Read-Host 'Password for geodata_directory (store it in your secret manager)' -AsSecureString
$directoryPasswordText = [System.Net.NetworkCredential]::new('', $directoryPassword).Password
$directoryPasswordSql = $directoryPasswordText.Replace("'", "''")
$directoryPasswordUrl = [uri]::EscapeDataString($directoryPasswordText)

@"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geodata_directory') THEN
    CREATE ROLE geodata_directory LOGIN PASSWORD '$directoryPasswordSql' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END `$`$;
GRANT CONNECT ON DATABASE webgis TO geodata_directory;
GRANT USAGE ON SCHEMA public TO geodata_directory;
GRANT SELECT (id, full_name, email, organization, status) ON TABLE public.users TO geodata_directory;
"@ | kubectl -n webgis exec -i auth-postgres-0 -- psql -U webgis_auth -d webgis -v ON_ERROR_STOP=1

$directoryUrl = "postgresql://geodata_directory:$directoryPasswordUrl@auth-postgres.webgis.svc.cluster.local:5432/webgis?sslmode=disable"
kubectl -n tile-server create secret generic geodata-webgis-directory --from-literal="database-url=$directoryUrl" --dry-run=client -o yaml | kubectl apply -f -
Remove-Variable directoryPasswordText,directoryPasswordSql,directoryPasswordUrl,directoryUrl -ErrorAction SilentlyContinue

# This resource belongs to the WebGIS database boundary, so apply it with its deployment.
kubectl apply -f deployment/integration/webgis-auth-postgres-networkpolicy.yaml
```

The upload API uses this connection only to search and validate recipients in
the admin access screen. The tile gateway uses it only to resolve the current
user's organisation for a restricted map. It cannot read password hashes,
sessions, or modify WebGIS data.

## Configure the GeoData catalog database

GeoData metadata is not stored in the WebGIS `db-auth` database. WebGIS remains
the identity authority; GeoData stores only the authenticated subject internally
for audit. This keeps authentication migrations, credentials, backup and access
control independent from the source-data catalog.

The manifests provision a dedicated `geodata` database in `tile-server`. Create
its Kubernetes Secret once before deployment; the password is generated locally
and is never printed by the script:

```powershell
& .\deployment\scripts\create-geodata-catalog-postgresql-secret.ps1
```

For a production shared PostgreSQL cluster, reuse the PostgreSQL _server_ if
desired, but create a separate `geodata` database and a dedicated `geodata` role.
Do not add GeoData tables to `db-auth` and do not synchronize tables between the
two services.

## Deploy

The storage manifests create a single-node SeaweedFS installation with a 100Gi
PVC, three private buckets (`geodata-raw`, `geodata-derived`, and
`geodata-published`), and raw-bucket versioning. The uploader identity is scoped
to `geodata-raw`; the conversion worker may read that bucket and write only to
`geodata-derived`; admin credentials are only used by the one-shot bucket job.
The S3 gRPC listener is intentionally not exposed by a Service and the storage
NetworkPolicy only permits S3 HTTP from the upload API and bucket bootstrap Job.
Ensure the cluster CNI enforces Kubernetes NetworkPolicy before applying.

```powershell
kubectl apply -k deployment
kubectl -n storage rollout status statefulset/seaweedfs --timeout=10m
kubectl -n storage wait --for=condition=complete job/geodata-bucket-bootstrap --timeout=5m
kubectl -n tile-server rollout restart deployment/geodata-upload
kubectl -n tile-server rollout restart deployment/geodata-worker
kubectl -n tile-server rollout restart deployment/geodata-tile-gateway
kubectl -n tile-server rollout restart deployment/geodata-frontend
kubectl -n tile-server rollout status deployment/geodata-upload --timeout=5m
kubectl -n tile-server rollout status deployment/geodata-worker --timeout=5m
kubectl -n tile-server rollout status deployment/geodata-tile-gateway --timeout=5m
kubectl -n tile-server rollout status deployment/geodata-frontend --timeout=5m
```

Set your GHCR `ghcr-pull` Secret in `tile-server` before rollout. GitHub Actions
publishes `geodata-upload:dev`, `geodata-worker:dev`, and `geodata-tile-gateway:dev` when `api/**` changes. The upload API enforces a
50 GiB maximum, streams files without buffering them on the frontend, and
supports `.osm.pbf`, GeoTIFF, GeoPackage, Shapefile ZIP, and MBTiles. Raw object
keys are generated server-side and never returned to the browser.

This is a single replica and one PVC for both SeaweedFS and PostgreSQL: it is a
development/single-node starting point, not HA or a backup strategy. Configure
storage-class capacity, snapshots, and tested restore before putting irreplaceable
data there. The upload API applies its idempotent catalog migration at startup;
every successful upload is stored in SeaweedFS and registered in PostgreSQL. The
local ingress is available at `http://geodata.localhost`.

Files uploaded before this catalog was introduced have no user-selected name or
data type, so they are intentionally not inferred from S3 and do not appear in
the catalog. Upload those files again, or add them through a future controlled
import workflow that explicitly supplies their metadata.

## Convert an OSM PBF with Tilemaker's default schema

The worker uses Tilemaker's built-in OpenMapTiles-compatible
`config-openmaptiles.json` and `process-openmaptiles.lua`; no custom styling or
schema is applied. Queue a conversion via the authenticated API after uploading
the source. `rawUploadId` is the identifier shown by the source-data API, not an
S3 key.

```powershell
$body = @{ rawUploadId = '<source-data-id>'; minZoom = 0; maxZoom = 14 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://geodata.localhost/api/geodata/v1/jobs' -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
```

The worker downloads the source into a short-lived `emptyDir`, writes a private
MBTiles artifact to `geodata-derived`, and records only its internal object key
in the catalog. Its development reservation is 512 MiB RAM, with an 8 GiB
runtime limit and up to 50 GiB node-local temporary space. For a country-scale
PBF, give Docker Desktop at least 10 GiB RAM (or run the worker on a dedicated
node); lowering the reservation only makes scheduling possible and does not
reduce Tilemaker's actual peak-memory requirement.

## Register artifacts and warm the existing WebGIS TileServer

Publishing no longer expands one MBTiles file into a large number of S3 tile
objects. After conversion the normal worker writes the immutable source to
`geodata-derived`; then the separate cache warmer in namespace `webgis` mounts
the existing `tile-data` PVC under its `mbtiles/geodata` directory, downloads
the MBTiles once, activates it atomically, rolls only `webgis/tile-server`, and
waits for `/datas/{dataset}.json`. The warmer records the artifact as `ready`.
Only ready artifacts can be selected for a draft, so publishing is a fast
metadata transition. The GeoData tile gateway preserves authentication and
authorization while proxying the fast local TileServer read.

Create namespace-local copies of the existing catalog and worker S3 Secrets
(they are namespace-scoped), then apply the separate WebGIS-owned workload:

```powershell
& .\deployment\scripts\create-geodata-tileserver-cache-warmer-secrets.ps1
kubectl apply -k deployment
kubectl apply -k deployment/webgis-cache-warmer
kubectl -n webgis rollout status deployment/geodata-tileserver-cache-warmer --timeout=5m
kubectl -n tile-server rollout restart deployment/geodata-worker,deployment/geodata-tile-gateway
kubectl -n tile-server rollout status deployment/geodata-worker --timeout=5m
kubectl -n tile-server rollout status deployment/geodata-tile-gateway --timeout=5m
```

The cache warmer's service account can only `get` and `patch` the one
`webgis/tile-server` Deployment; the patch changes a pod-template annotation
after a new MBTiles file is atomically placed, forcing TileServer to rebuild
its otherwise startup-only catalog. Apply migrations
`009_artifact_cache_ready.sql` and `010_access_policy_and_cache_retry.sql`
before rolling these workloads.

On the current one-node WebGIS setup, `tile-data` is a `ReadWriteOnce` PVC and
the TileServer is read-only while the warmer writes. This is sufficient for the
single-node cluster. Before scaling to multiple nodes or TileServer replicas,
replace `webgis/tile-data` with an RWX NFS (or equivalent shared filesystem)
PVC mounted at the same `/tile-server/data` path. Do not mount a PVC across
namespaces; Kubernetes does not permit that.
