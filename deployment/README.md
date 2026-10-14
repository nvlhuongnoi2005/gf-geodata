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
  $rng.GetBytes($adminKeyBytes)
  $rng.GetBytes($adminSecretBytes)
  $rng.GetBytes($uploadKeyBytes)
  $rng.GetBytes($uploadSecretBytes)
} finally {
  $rng.Dispose()
}
$adminKey = [BitConverter]::ToString($adminKeyBytes).Replace('-', '')
$adminSecret = [Convert]::ToBase64String($adminSecretBytes)
$uploadKey = [BitConverter]::ToString($uploadKeyBytes).Replace('-', '')
$uploadSecret = [Convert]::ToBase64String($uploadSecretBytes)
if ([string]::IsNullOrWhiteSpace($adminKey) -or [string]::IsNullOrWhiteSpace($adminSecret) -or [string]::IsNullOrWhiteSpace($uploadKey) -or [string]::IsNullOrWhiteSpace($uploadSecret)) {
  throw 'Generated S3 credential is empty; no Secret was created.'
}
$config = @{
  identities = @(
    @{ name = 'bootstrap-admin'; credentials = @(@{ accessKey = $adminKey; secretKey = $adminSecret }); actions = @('Admin','Read','Write','List','Tagging') },
    @{ name = 'geodata-upload'; credentials = @(@{ accessKey = $uploadKey; secretKey = $uploadSecret }); actions = @('Write','List'); resources = @('buckets/geodata-raw/') }
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

$bootstrapSecret = kubectl -n storage get secret geodata-s3-bootstrap -o json | ConvertFrom-Json
if ($bootstrapSecret.data.'access-key'.Length -eq 0 -or $bootstrapSecret.data.'secret-key'.Length -eq 0) {
  throw 'Bootstrap Secret contains an empty key; stop and recreate it before deploying.'
}
```

If either S3 credential Secret was accidentally created with blank values, use
the checked script below. It safely rotates both identities together and stops
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

For a production shared PostgreSQL cluster, reuse the PostgreSQL *server* if
desired, but create a separate `geodata` database and a dedicated `geodata` role.
Do not add GeoData tables to `db-auth` and do not synchronize tables between the
two services.

## Deploy

The storage manifests create a single-node SeaweedFS installation with a 100Gi
PVC, three private buckets (`geodata-raw`, `geodata-derived`, and
`geodata-published`), and raw-bucket versioning. The uploader identity is scoped
to `geodata-raw`; admin credentials are only used by the one-shot bucket job.
The S3 gRPC listener is intentionally not exposed by a Service and the storage
NetworkPolicy only permits S3 HTTP from the upload API and bucket bootstrap Job.
Ensure the cluster CNI enforces Kubernetes NetworkPolicy before applying.

```powershell
kubectl apply -k deployment
kubectl -n storage rollout status statefulset/seaweedfs --timeout=10m
kubectl -n storage wait --for=condition=complete job/geodata-bucket-bootstrap --timeout=5m
kubectl -n tile-server rollout restart deployment/geodata-upload
kubectl -n tile-server rollout restart deployment/geodata-frontend
kubectl -n tile-server rollout status deployment/geodata-upload --timeout=5m
kubectl -n tile-server rollout status deployment/geodata-frontend --timeout=5m
```

Set your GHCR `ghcr-pull` Secret in `tile-server` before rollout. GitHub Actions
publishes `geodata-upload:dev` when `api/**` changes. The upload API enforces a
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

