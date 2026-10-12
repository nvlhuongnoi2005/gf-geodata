# SeaweedFS S3 storage

`ms-geodata` runs a private, single-node SeaweedFS installation for the MVP.
It exposes only an S3-compatible `ClusterIP` service at:

`http://seaweedfs-s3.tile-server.svc.cluster.local:8333`

The SeaweedFS pod combines master, filer, volume server and S3 gateway. This
keeps the one-node deployment operable, but is intentionally **not HA**. A
lost Kubernetes node or its persistent volume interrupts the service and can
lose data. Versioning is protection against accidental object deletion; it is
not a replacement for a backup stored outside this node.

## Data and access boundaries

| Bucket | Writer | Reader | Purpose |
| --- | --- | --- | --- |
| `geodata-raw` | Geodata API, GDAL worker | Geodata API, GDAL worker | Immutable source versions and private upload staging. |
| `geodata-derived` | GDAL worker | API, GDAL worker, tile gateway | Validation output and tileset artifacts. |
| `geodata-styles` | Geodata API | API, tile gateway | Versioned MapLibre styles, sprites and glyph assets. |

The browser never receives a SeaweedFS access key and must never read tiles or
styles from this endpoint. The tile gateway authenticates every catalog,
style, TileJSON, sprite and tile request before fetching a private object.

The default deployment has no S3 ingress. For browser upload of large raw
files, use the optional `s3-upload-ingress.example.yaml` only on the private
network and only with short-lived, multipart presigned URLs bound to a single
`geodata-raw/staging/<dataset-version>/...` key. This is a deliberately narrow
exception to the no-direct-browser-access rule: it permits an upload, but does
not expose a credential, list permission, read permission, or a tile URL.
Create the TLS secret named by that example before applying it.

## Provisioning

Mirror the exact SeaweedFS image specified in `seaweedfs.yaml` into
`registry.internal` before deployment. Pin and acceptance-test a new image
version before changing this manifest; never use `latest`.

Create the two secrets outside Git:

```sh
cp deployment/storage/seaweedfs-s3-config.example.yaml deployment/storage/seaweedfs-s3-config.yaml
cp deployment/storage/s3-bootstrap-credentials.example.yaml deployment/storage/s3-bootstrap-credentials.yaml
# Generate unique keys. The bootstrap credentials must match the bootstrap
# identity in seaweedfs-s3-config.yaml.
kubectl apply -f deployment/namespace.yaml
kubectl apply -f deployment/storage/seaweedfs-s3-config.yaml
kubectl apply -f deployment/storage/s3-bootstrap-credentials.yaml
kubectl apply -k deployment/storage
```

The bootstrap Job waits for the S3 endpoint, creates the three buckets, turns
on versioning, expires non-current versions and aborts incomplete multipart
uploads after two days. It uses `registry.internal/platform/aws-cli:2.31.22`;
mirror that image too.

Use separate Kubernetes Secrets for the future API, GDAL worker and tile
gateway. Do not mount `seaweedfs-s3-config` into those workloads: that file
contains every identity. Their credentials must correspond to the minimum
actions shown in the template.

## Capacity and processing

The default PVC requests 1 TiB and reserves 100 GiB free space. Change the
StorageClass or requested capacity before applying where the cluster does not
have a suitable default local/SSD-backed class. Never substitute `emptyDir`.

For a 100 GB source, capacity must include raw data, a GDAL scratch volume,
derived artifacts, retained versions and at least 30% headroom. The GDAL worker
downloads the raw object to its separate scratch PVC, processes it locally,
then multipart-uploads its validated result; it must not mount or process the
SeaweedFS data directory directly.

Before production use, run a test against the exact mirrored image with a 100
GB representative file: multipart upload, interrupted resume, checksum,
range-read, GDAL conversion, publish, rollback and lifecycle cleanup. Back up
the SeaweedFS PVC data to storage outside this node and rehearse a restore.

## Future scale-out

Application code talks only S3, so no code migration is required when the
storage topology grows. Replace this all-in-one StatefulSet with separate
SeaweedFS master (odd replica count), filer, volume and stateless S3 gateway
components; add volume nodes on independent disks and replication only when
there are independent failure domains. Do not claim HA while Kubernetes still
has one node.
