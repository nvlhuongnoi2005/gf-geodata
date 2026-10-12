# Tile-server namespace

`ms-geodata` uses a dedicated Kubernetes namespace named `tile-server`.

- It will contain Geodata Admin, the Geodata API, GDAL workers and the tile gateway.
- The existing `map` application remains in namespace `webgis` and remains the identity authority.
- The frontend Service is intentionally internal. A later ingress change in `map` will expose it at `/geodata-admin` on the shared WebGIS origin so the existing `/auth` session flow is reused.

The current local ingress exposes the frontend at `http://geodata.localhost`.
It is intended for UI development. `webgis.localhost` and `geodata.localhost` have separate host-only browser cookies, so the current WebGIS refresh session is not shared automatically. Production admin access should use a shared origin such as `/geodata-admin`, or `db-auth` must be upgraded to an SSO/cross-subdomain session design.

## Air-gapped deployment

The application must not make Internet connections at runtime or deployment time.

- Mirror all base and runtime images into `registry.internal` before applying manifests.
- Build frontend images from `registry.internal/base/node:24-alpine` and `registry.internal/base/nginx:1.27-alpine`; these are the Dockerfile defaults.
- Mirror SeaweedFS as `registry.internal/platform/seaweedfs:4.44` and the S3
  bootstrap image as `registry.internal/platform/aws-cli:2.31.22`.
- Configure npm to use the internal package mirror/cache before running `npm ci` in an offline build environment.
- Configure the future API and worker NetworkPolicies with explicit egress only to internal DNS, WebGIS auth and the internal SeaweedFS S3 endpoint. Never permit a catch-all Internet egress rule.
- Map styles, glyphs, sprites, icons and basemap data must be stored and served internally; no external MapLibre style, font or tile URL is permitted.

### Local Docker Desktop build

The production frontend Deployment must use an image mirrored into the internal
registry. For the current connected development cluster it uses the rolling
tag `ghcr.io/nvlhuongnoi2005/tile-server/front-end:dev`. The GitHub Actions
workflow rebuilds and pushes this tag on every push to `master`; it also writes
a traceable `sha-<commit>` tag. Ensure GitHub Actions has **Read and write
permissions** for repository workflows/packages before the first run.

For a local-only test, rebuild and restart manually:

```powershell
docker build `
  --build-arg NODE_IMAGE=node:24-alpine `
  --build-arg NGINX_IMAGE=nginx:1.27-alpine `
  -f fe/Dockerfile `
  -t ghcr.io/nvlhuongnoi2005/tile-server/front-end:dev .
docker push ghcr.io/nvlhuongnoi2005/tile-server/front-end:dev
kubectl -n tile-server rollout restart deployment/geodata-frontend
kubectl -n tile-server rollout status deployment/geodata-frontend
```

This remains air-gapped only when `node:24-alpine` and `nginx:1.27-alpine`
are already loaded into Docker Desktop from the internal artifact store, for
example with `docker load -i base-images.tar`. If either image is absent, do
not allow Docker to pull it from the Internet; mirror or export it internally
first.

On a local workstation that already has the prior frontend runtime image but
does not have the Node/Nginx build bases, use `fe/Dockerfile.runtime` after
`npm run build`. It layers the newly built static assets over the existing
local runtime image without pulling a base image.

After the storage bootstrap has completed, apply the namespace and current frontend skeleton:

```sh
kubectl apply -k deployment
```

Provision SeaweedFS only after applying the two real secrets described in
[storage/README.md](storage/README.md). The current topology is single-node,
private and backed by a persistent volume; it is not HA.

