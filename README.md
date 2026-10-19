# GeoData — Nền tảng GeoForce

**GeoData** là dịch vụ quản trị, chuyển đổi và phát hành dữ liệu không gian của nền tảng **GeoForce**. Dịch vụ cho phép quản trị viên đưa dữ liệu nguồn vào hệ thống, chuyển đổi thành MBTiles, phát hành phiên bản bản đồ và cung cấp catalog/tile theo quyền truy cập của người dùng GeoForce.

GeoData là một thành phần của GeoForce, không phải một nền tảng WebGIS độc lập. GeoForce đảm nhiệm xác thực, danh bạ người dùng và trải nghiệm bản đồ; GeoData quản lý vòng đời dữ liệu địa lý và quyền truy cập tới các bản đồ đã phát hành.

## Chức năng chính

- Upload dữ liệu nguồn: OSM PBF, GeoTIFF, GeoPackage, Shapefile ZIP và MBTiles.
- Chuyển đổi dữ liệu nguồn sang MBTiles bằng worker nền.
- Import trực tiếp MBTiles có sẵn.
- Quản lý artifact, phiên bản bản đồ, style MapLibre và sprite.
- Phát hành bản đồ với chính sách công khai hoặc cấp quyền theo người dùng/đơn vị GeoForce.
- Cung cấp catalog, TileJSON, tile, style, sprite và preview qua gateway có kiểm tra quyền.

## Kiến trúc tổng quan

~~~text
Quản trị viên GeoForce
        |
        v
GeoData Frontend ── /auth ──> GeoForce Controller / Auth
        |                              |
        v                              v
GeoData Upload API <──────────────── JWT / JWKS
        |
        +--> GeoData PostgreSQL          metadata, job, release, grant
        +--> SeaweedFS S3                dữ liệu nguồn và artifact bất biến
        |
        v
GeoData Worker ──> MBTiles ──> geodata-derived
        |
        v
MBTiles Store Warmer ──> geodata-mbtiles-data PVC
        |
        v
GeoData Tile Gateway <── GeoForce Controller <── GeoForce Map layers
~~~

Các nguyên tắc chính:

- Dữ liệu nguồn và artifact MBTiles bất biến được lưu trong object storage riêng tư.
- Tile Gateway đọc MBTiles trực tiếp từ PVC phục vụ; trình duyệt không nhận S3 credential, bucket, object key hoặc đường dẫn PVC.
- GeoForce là nguồn xác thực và danh bạ người dùng/đơn vị. GeoData không tạo tài khoản hay phát hành token đăng nhập.
- GeoData dùng PostgreSQL catalog riêng, không tạo bảng trong cơ sở dữ liệu xác thực của GeoForce.
- Catalog GeoForce chỉ hiển thị bản đồ công khai hoặc bản đồ mà người dùng/đơn vị hiện tại được cấp quyền.

## Thành phần trong repository

| Thư mục | Nội dung |
| --- | --- |
| `fe/` | React/Vite frontend quản trị GeoData. |
| `api/cmd/geodata-upload/` | Go API cho upload, catalog, release, style và phân quyền. |
| `api/cmd/geodata-worker/` | Go worker chuyển đổi dữ liệu nguồn thành MBTiles. |
| `api/cmd/geodata-tile-gateway/` | Gateway cung cấp catalog, tile, style, sprite và preview. |
| `api/internal/` | Catalog PostgreSQL, storage, MBTiles reader, thumbnail và các thành phần dùng chung. |
| `deployment/` | Kubernetes Kustomize cho database, storage, API, worker, warmer, gateway và frontend. |

## Tài liệu chi tiết

| Tài liệu | Nội dung |
| --- | --- |
| [API và kiến trúc](api/README.md) | Thành phần, luồng dữ liệu, MBTiles, release, preview, phân quyền và tích hợp GeoForce. |
| [Triển khai Kubernetes](deployment/README.md) | Secret, SeaweedFS, PostgreSQL, migration, rollout và xoay credential. |

## Yêu cầu

- Kubernetes và `kubectl`.
- Ingress controller để truy cập HTTP.
- Quyền pull image GHCR trong namespace `tile-server`.
- GeoForce Controller/Auth đang chạy trong namespace `webgis`.
- SeaweedFS S3, PostgreSQL và các Kubernetes Secret theo hướng dẫn triển khai.
- Node.js và npm để phát triển frontend; Go theo phiên bản trong module/Dockerfile API để xây dựng service.

## Chạy giao diện cục bộ

Phần này chỉ chạy giao diện quản trị GeoData. API upload, worker, PostgreSQL,
SeaweedFS và Tile Gateway **không** tự được khởi động bằng lệnh dưới đây; hãy
triển khai chúng trên Kubernetes theo phần [Cài đặt và triển khai](#cài-đặt-và-triển-khai).

Sao chép `.env.example` thành `.env`, sau đó đặt URL GeoForce phù hợp với môi trường:

~~~powershell
npm install
npm run dev
~~~

Vite sẽ dùng các URL trong `.env` để proxy xác thực và gọi các dịch vụ GeoForce
đã có sẵn. Vì vậy, trước khi kiểm thử các thao tác upload, chuyển đổi hoặc phát
hành từ giao diện cục bộ, cần có một môi trường GeoData/WebGIS đã triển khai và
có thể truy cập từ máy phát triển.

Các biến quan trọng:

| Biến | Mục đích |
| --- | --- |
| `VITE_MAP_AUTH_URL` | URL GeoForce Auth dùng cho proxy Vite. |
| `VITE_MAP_LOGIN_URL` | Trang đăng nhập GeoForce. |
| `VITE_WEBGIS_MAP_URL` | Trang bản đồ GeoForce. |
| `VITE_PUBLIC_BASE_PATH` | Base path khi host frontend dưới một prefix. |
| `VITE_GEODATA_DEMO` | Chỉ dùng cho giao diện demo; đặt `false` khi kết nối dịch vụ thực. |

Kiểm tra build frontend:

~~~powershell
npm run build
~~~

## Cài đặt và triển khai

1. Đọc [hướng dẫn triển khai](deployment/README.md) và tạo các Secret S3, PostgreSQL, JWT cùng kết nối danh bạ GeoForce chỉ-đọc.
2. Apply toàn bộ manifest:

   ~~~powershell
   kubectl apply -k deployment
   ~~~

3. Chờ các workload sẵn sàng:

   ~~~powershell
   kubectl -n storage rollout status statefulset/seaweedfs --timeout=10m
   kubectl -n storage wait --for=condition=complete job/geodata-bucket-bootstrap --timeout=5m
   kubectl -n tile-server rollout status deployment/geodata-upload --timeout=5m
   kubectl -n tile-server rollout status deployment/geodata-worker --timeout=5m
   kubectl -n tile-server rollout status deployment/geodata-mbtiles-store-warmer --timeout=5m
   kubectl -n tile-server rollout status deployment/geodata-tile-gateway --timeout=5m
   kubectl -n tile-server rollout status deployment/geodata-frontend --timeout=5m
   ~~~

4. Cấu hình `GEODATA_INTERNAL_URL` tại GeoForce Controller trỏ tới GeoData Tile Gateway:

   ~~~text
   http://geodata-tile-gateway.tile-server.svc.cluster.local:8091
   ~~~

GeoData Upload API chạy migration SQL theo cách idempotent khi khởi động. Không chạy migration thủ công trừ khi tài liệu triển khai của phiên bản đó yêu cầu rõ ràng.

## Luồng sử dụng

1. Đăng nhập GeoForce với tài khoản quản trị và mở GeoData.
2. Upload dữ liệu nguồn, nhập tên hiển thị và loại dữ liệu.
3. Tạo job chuyển đổi nếu nguồn chưa phải MBTiles.
4. Chờ artifact MBTiles sẵn sàng trong kho phục vụ.
5. Tạo release nháp: tạo bản đồ mới với version `1.0.0`, hoặc chọn map hiện có và tăng semantic version.
6. Chọn style/sprite nếu cần, sau đó phát hành release.
7. Chọn công khai hoặc cấp quyền cho người dùng/đơn vị GeoForce.
8. Người dùng GeoForce mở **Lớp bản đồ** để tải catalog đã lọc theo quyền.

## Kiểm tra nhanh

~~~powershell
kubectl -n tile-server get pods
kubectl -n storage get pods
kubectl -n tile-server logs deployment/geodata-upload --tail=100
kubectl -n tile-server logs deployment/geodata-tile-gateway --tail=100
~~~

Khi kiểm tra qua LAN, `APP_ORIGINS` của GeoForce phải chứa đúng toàn bộ origin đang mở trong trình duyệt, gồm protocol và port. Ví dụ `http://192.168.26.235` khác `http://192.168.26.235:8080`. Sau khi thay ConfigMap, restart GeoForce Controller để nạp lại biến môi trường.

## Bảo mật và vận hành

- Không commit `.env`, kubeconfig, mật khẩu, JWT key hoặc S3 credential.
- Dùng role PostgreSQL riêng, chỉ-đọc để GeoData tra danh bạ GeoForce.
- Không đưa URL tile, S3 hay storage nội bộ trực tiếp vào frontend; luôn dùng gateway và grant.
- Sao lưu PostgreSQL cùng bucket/PVC trước khi đưa dữ liệu không thể thay thế vào hệ thống.
- Manifest hiện tại phù hợp cho môi trường phát triển hoặc một node; cần cấu hình storage HA, snapshot và restore đã kiểm thử trước khi dùng production.
