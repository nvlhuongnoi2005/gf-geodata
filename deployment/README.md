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

$adminKey = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(10))
$adminSecret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).TrimEnd('=').Replace('+','-').Replace('/','_')
$uploadKey = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(10))
$uploadSecret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).TrimEnd('=').Replace('+','-').Replace('/','_')
$config = @{
  identities = @(
    @{ name = 'bootstrap-admin'; credentials = @(@{ accessKey = $adminKey; secretKey = $adminSecret }); actions = @('Admin','Read','Write','List','Tagging') },
    @{ name = 'geodata-upload'; credentials = @(@{ accessKey = $uploadKey; secretKey = $uploadSecret }); actions = @('Write:geodata-raw','List:geodata-raw') }
  )
} | ConvertTo-Json -Depth 8 -Compress

$config | kubectl -n storage create secret generic geodata-seaweed-s3-config --from-literal="s3.json=$config" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n storage create secret generic geodata-s3-bootstrap --from-literal="access-key=$adminKey" --from-literal="secret-key=$adminSecret" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n tile-server create secret generic geodata-upload-s3 --from-literal="access-key=$uploadKey" --from-literal="secret-key=$uploadSecret" --dry-run=client -o yaml | kubectl apply -f -
```

Create the auth Secret using the actual values configured by WebGIS. Do not
guess the JWKS path or issuer; obtain them from the identity service/token
configuration. The upload API expects a signed JWT with matching `iss`, `aud`,
expiration and an admin claim (`role: admin`, `roles` containing `admin`, or
`scope` containing `geodata:admin`).

```powershell
$jwksUrl = '<actual WebGIS JWKS URL>'
$issuer = '<exact JWT iss>'
$audience = '<exact JWT aud>'
kubectl -n tile-server create secret generic geodata-upload-auth --from-literal="jwks-url=$jwksUrl" --from-literal="issuer=$issuer" --from-literal="audience=$audience" --dry-run=client -o yaml | kubectl apply -f -
```

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
kubectl -n tile-server rollout status deployment/geodata-upload --timeout=5m
kubectl -n tile-server rollout status deployment/geodata-frontend --timeout=5m
```

Set your GHCR `ghcr-pull` Secret in `tile-server` before rollout. GitHub Actions
publishes `geodata-upload:dev` when `api/**` changes. The upload API enforces a
50 GiB maximum, streams files without buffering them on the frontend, and
supports `.osm.pbf`, GeoTIFF, GeoPackage, Shapefile ZIP, and MBTiles. Raw object
keys are generated server-side and never returned to the browser.

This is a single replica and one PVC: it is a development/single-node starting
point, not HA or a backup strategy. Configure storage-class capacity, snapshots,
and tested restore before putting irreplaceable data there. The upload service
does not yet register uploaded objects in a database; dataset catalog and
processing records are a separate next step. The local ingress is available at
`http://geodata.localhost`.

