# Triển khai GeoData trên Kubernetes

GeoData chạy ở namespace `tile-server`, dùng SeaweedFS riêng tư ở `storage` và tái sử dụng xác thực/danh bạ của WebGIS. GeoData chỉ sở hữu catalog, job, release và quyền bản đồ; WebGIS vẫn sở hữu tài khoản và JWT.

> Manifest hiện phù hợp cho môi trường phát triển hoặc cụm một node. Production cần storage HA, sao lưu, snapshot và kế hoạch khôi phục đã kiểm thử.

## Điều kiện cần có

- Quyền `kubectl` với namespace `storage`, `tile-server` và `webgis`.
- WebGIS Controller/Auth đang chạy, công bố JWKS ở `/auth/.well-known/jwks.json`.
- CNI có thực thi `NetworkPolicy`, StorageClass cho PVC và quyền pull image GHCR.
- Không commit mật khẩu, khóa JWT hay Secret đã điền giá trị.

## 1. Tạo Secret

Tạo các Secret được manifest tham chiếu trước khi apply. Mỗi identity S3 chỉ nhận quyền tối thiểu: uploader ghi `geodata-raw`; worker đọc raw và ghi `geodata-derived`; thông tin quản trị chỉ dùng cho Job tạo bucket. Chạy khối lệnh dưới đây từ thư mục gốc repository; nó tạo credential ngẫu nhiên, apply Secret mà không ghi credential vào tệp và kiểm tra bootstrap Secret trước khi tiếp tục.

~~~powershell
kubectl apply -f deployment/namespace.yaml
kubectl create namespace storage --dry-run=client -o yaml | kubectl apply -f -
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $adminKeyBytes = New-Object byte[] 10; $adminSecretBytes = New-Object byte[] 32
  $uploadKeyBytes = New-Object byte[] 10; $uploadSecretBytes = New-Object byte[] 32
  $workerKeyBytes = New-Object byte[] 10; $workerSecretBytes = New-Object byte[] 32
  $rng.GetBytes($adminKeyBytes); $rng.GetBytes($adminSecretBytes)
  $rng.GetBytes($uploadKeyBytes); $rng.GetBytes($uploadSecretBytes)
  $rng.GetBytes($workerKeyBytes); $rng.GetBytes($workerSecretBytes)
} finally { $rng.Dispose() }
$adminKey = [BitConverter]::ToString($adminKeyBytes).Replace('-', '')
$adminSecret = [Convert]::ToBase64String($adminSecretBytes)
$uploadKey = [BitConverter]::ToString($uploadKeyBytes).Replace('-', '')
$uploadSecret = [Convert]::ToBase64String($uploadSecretBytes)
$workerKey = [BitConverter]::ToString($workerKeyBytes).Replace('-', '')
$workerSecret = [Convert]::ToBase64String($workerSecretBytes)
if ([string]::IsNullOrWhiteSpace($adminKey) -or [string]::IsNullOrWhiteSpace($adminSecret) -or [string]::IsNullOrWhiteSpace($uploadKey) -or [string]::IsNullOrWhiteSpace($uploadSecret) -or [string]::IsNullOrWhiteSpace($workerKey) -or [string]::IsNullOrWhiteSpace($workerSecret)) { throw 'Generated S3 credential is empty; no Secret was created.' }
$config = @{ identities = @(
  @{ name = 'bootstrap-admin'; credentials = @(@{ accessKey = $adminKey; secretKey = $adminSecret }); actions = @('Admin','Read','Write','List','Tagging') },
  @{ name = 'geodata-upload'; credentials = @(@{ accessKey = $uploadKey; secretKey = $uploadSecret }); actions = @('Read','Write','List'); resources = @('buckets/geodata-raw/','buckets/geodata-derived/') },
  @{ name = 'geodata-worker'; credentials = @(@{ accessKey = $workerKey; secretKey = $workerSecret }); actions = @('Read','Write','List'); resources = @('buckets/geodata-raw/','buckets/geodata-derived/') }
) } | ConvertTo-Json -Depth 8 -Compress
$s3ConfigFile = New-TemporaryFile
try { [System.IO.File]::WriteAllText($s3ConfigFile.FullName, $config, (New-Object System.Text.UTF8Encoding($false))); kubectl -n storage create secret generic geodata-seaweed-s3-config --from-file="s3.json=$($s3ConfigFile.FullName)" --dry-run=client -o yaml | kubectl apply -f - } finally { Remove-Item -LiteralPath $s3ConfigFile.FullName -Force }
kubectl -n storage create secret generic geodata-s3-bootstrap --from-literal="access-key=$adminKey" --from-literal="secret-key=$adminSecret" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n tile-server create secret generic geodata-upload-s3 --from-literal="access-key=$uploadKey" --from-literal="secret-key=$uploadSecret" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n tile-server create secret generic geodata-worker-s3 --from-literal="access-key=$workerKey" --from-literal="secret-key=$workerSecret" --dry-run=client -o yaml | kubectl apply -f -
$bootstrapSecret = kubectl -n storage get secret geodata-s3-bootstrap -o json | ConvertFrom-Json
if ($bootstrapSecret.data.'access-key'.Length -eq 0 -or $bootstrapSecret.data.'secret-key'.Length -eq 0) { throw 'Bootstrap Secret contains an empty key; stop and recreate it before deploying.' }
~~~

Khối lệnh đã tạo `geodata-upload-s3` và `geodata-worker-s3`. Tạo tiếp `geodata-upload-auth`, `geodata-webgis-directory`, `geodata-catalog-postgresql` và `ghcr-pull`; lưu credential trong password manager để có thể xoay vòng.

`geodata-upload-auth` phải có issuer, audience và JWKS URL của WebGIS. `geodata-webgis-directory` dùng một role PostgreSQL chỉ-đọc có quyền tối thiểu trên `webgis.users`; không dùng lại mật khẩu role auth của WebGIS và không đồng bộ bảng người dùng.

`geodata-catalog-postgresql` trỏ đến database `geodata` và role riêng. Tạo Secret catalog cùng Secret cache-warmer bằng script có sẵn:

~~~powershell
& .\deployment\scripts\create-geodata-catalog-postgresql-secret.ps1
~~~

Có thể dùng chung PostgreSQL server với WebGIS nhưng không thêm bảng GeoData vào database auth. Upload API chạy migration idempotent khi khởi động; không sửa tay lịch sử migration.

Nếu cần xoay credential S3, dùng script thay vì sửa Secret từng phần:

~~~powershell
& .\deployment\scripts\rotate-geodata-s3-credentials.ps1
kubectl -n storage rollout restart statefulset/seaweedfs
kubectl -n storage rollout status statefulset/seaweedfs --timeout=10m
kubectl -n storage delete job geodata-bucket-bootstrap --ignore-not-found
kubectl apply -k deployment/storage
kubectl -n storage wait --for=condition=complete job/geodata-bucket-bootstrap --timeout=5m
~~~

## 2. Triển khai

~~~powershell
kubectl apply -k deployment
kubectl -n storage rollout status statefulset/seaweedfs --timeout=10m
kubectl -n storage wait --for=condition=complete job/geodata-bucket-bootstrap --timeout=5m
kubectl -n tile-server rollout status deployment/geodata-upload --timeout=5m
kubectl -n tile-server rollout status deployment/geodata-worker --timeout=5m
kubectl -n tile-server rollout status deployment/geodata-mbtiles-store-warmer --timeout=5m
kubectl -n tile-server rollout status deployment/geodata-tile-gateway --timeout=5m
kubectl -n tile-server rollout status deployment/geodata-frontend --timeout=5m
~~~

SeaweedFS tạo các bucket riêng tư `geodata-raw`, `geodata-derived` và `geodata-published`; raw bucket có versioning. Upload API giới hạn tệp 50 GiB, stream thay vì đệm toàn bộ trên trình duyệt và nhận `.osm.pbf`, GeoTIFF, GeoPackage, Shapefile ZIP và MBTiles.

CI publish `geodata-upload:dev`, `geodata-worker:dev` và `geodata-tile-gateway:dev` khi `api/**` thay đổi. Dùng tag bất biến và cập nhật manifest/GitOps khi triển khai production.

## 3. Chuyển đổi và phục vụ MBTiles

Worker chuyển đổi OSM PBF bằng schema OpenMapTiles mặc định của Tilemaker. `rawUploadId` là ID trong catalog, không phải S3 key.

~~~powershell
$body = @{ rawUploadId = '<source-data-id>'; minZoom = 0; maxZoom = 14 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://geodata.localhost/api/geodata/v1/jobs' -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
~~~

Worker dùng `emptyDir` cho dữ liệu tạm, lưu artifact bất biến trong `geodata-derived`. `geodata-mbtiles-store-warmer` materialize artifact vào PVC `geodata-mbtiles-data` bằng rename nguyên tử; Tile Gateway đọc SQLite trực tiếp từ PVC, không gọi hay restart Tile Server cũ.

PBF cỡ quốc gia cần khoảng 10 GiB RAM. Với nhiều node, thay PVC `ReadWriteOnce` bằng storage RWX (NFS/CephFS) hoặc ghép warmer và gateway trên cùng node. Warmer tạo preview PNG 640×360 cho raster; preview vector hiện là placeholder vì chưa có MapLibre Native renderer kèm style, sprite và glyph.

## 4. Tích hợp WebGIS

Cấu hình Controller WebGIS:

~~~text
GEODATA_INTERNAL_URL=http://geodata-tile-gateway.tile-server.svc.cluster.local:8091
~~~

Controller kiểm tra `map:read`, chuyển tiếp bearer token và proxy catalog, TileJSON, tile, style, sprite và preview. Trình duyệt không được nhận địa chỉ nội bộ, S3 key hay đường dẫn PVC.

~~~powershell
# GeoData
kubectl apply -k deployment
kubectl -n tile-server rollout restart deployment/geodata-tile-gateway

# WebGIS (sau khi build/push image của cả hai phía)
kubectl apply -k deployment/core
kubectl -n webgis rollout restart deployment/controller deployment/frontend
~~~

## Vận hành và xử lý sự cố

~~~powershell
kubectl -n tile-server get pods
kubectl -n storage get pods
kubectl -n tile-server logs deployment/geodata-upload --tail=100
kubectl -n tile-server logs deployment/geodata-tile-gateway --tail=100
~~~

- Catalog rỗng: kiểm tra `GEODATA_INTERNAL_URL`, issuer/audience/JWKS, bearer token được Controller chuyển tiếp và role danh bạ.
- Map không xuất hiện: release phải published, artifact phải sẵn sàng trên PVC và chính sách/grant phải khớp người gọi.
- Không có preview: kiểm tra warmer, trạng thái `ready` và request qua Controller có Authorization header.
- Sau thay đổi API/migration, rollout đúng workload: `geodata-upload` cho catalog hoặc `geodata-tile-gateway` cho gateway/quyền.

Sao lưu PostgreSQL, bucket và PVC trước khi nạp dữ liệu không thể thay thế. Sau khi xoay credential, kiểm tra rollout trước khi thu hồi giá trị cũ.
