# GeoData: API, chuyển đổi và phục vụ bản đồ

GeoData là hệ thống quản trị dữ liệu không gian riêng cho WebGIS. Hệ thống nhận dữ liệu gốc, lưu metadata catalog, chuyển đổi sang MBTiles bất biến, phát hành bản đồ, rồi phục vụ tile qua gateway có kiểm tra quyền truy cập.

WebGIS vẫn là hệ thống xác thực và danh bạ người dùng. GeoData không tạo tài khoản, không phát hành token đăng nhập, đồng thời không bao giờ trả S3 credential, tên bucket, object key hoặc đường dẫn volume phục vụ tile cho trình duyệt.

## Thành phần và trách nhiệm

| Thành phần | Trách nhiệm |
| --- | --- |
| geodata-upload | API quản trị: upload dữ liệu nguồn, metadata catalog, job chuyển đổi, import MBTiles, bản phát hành, style và quyền truy cập. Service này tự chạy migration database khi khởi động. |
| geodata-worker | Nhận job chuyển đổi theo cơ chế atomic, tải dữ liệu nguồn riêng tư và tạo artifact MBTiles bất biến. |
| geodata-mbtiles-store-warmer | Sao chép một lần artifact hoàn thành từ object storage sang PVC phục vụ tile bằng atomic rename; đồng thời tạo ảnh thu nhỏ cho bản phát hành. |
| geodata-tile-gateway | Đọc MBTiles trực tiếp từ PVC và cung cấp catalog WebGIS, tile, style, sprite, TileJSON và preview có bảo vệ quyền. |
| GeoData PostgreSQL | Lưu metadata, trạng thái vòng đời, release, audit event và grant. Database này tách biệt với dữ liệu xác thực WebGIS. |
| SeaweedFS S3 | Lưu dữ liệu nguồn riêng tư, artifact dẫn xuất bất biến, style/sprite đã import và ảnh preview. |

## Luồng dữ liệu

~~~text
Quản trị viên upload / import MBTiles trực tiếp
  -> bản ghi catalog dữ liệu nguồn + object riêng tư trong geodata-raw
  -> job chuyển đổi (nếu nguồn chưa là MBTiles)
  -> MBTiles bất biến trong geodata-derived
  -> bản sao phục vụ trong PVC geodata-mbtiles-data
  -> artifact sẵn sàng
  -> bản nháp phát hành
  -> phát hành
  -> catalog và tile WebGIS đã lọc theo quyền
~~~

### Upload và chuyển đổi dữ liệu nguồn

PUT /api/geodata/v1/uploads nhận file theo luồng (stream), không giữ toàn bộ file trong bộ nhớ của trình duyệt hay API. Request mang metadata do người dùng nhập, ví dụ tên hiển thị và loại dữ liệu; đường dẫn nội bộ trong storage luôn do server sinh.

Các định dạng nguồn được hỗ trợ: OSM PBF, GeoTIFF, GeoPackage, Shapefile ZIP và MBTiles. Với OSM PBF, worker dùng schema OpenMapTiles-compatible có sẵn của Tilemaker. Các luồng chuyển đổi khác sử dụng GDAL phù hợp trong worker image.

POST /api/geodata/v1/jobs tạo job chuyển đổi từ một dữ liệu trong catalog. Job được worker nhận theo cơ chế atomic, vì vậy nhiều replica worker sau này vẫn có thể xử lý các job khác nhau an toàn. Artifact chuyển đổi thành công là bất biến; nhiều phiên bản bản đồ có thể tái sử dụng nó mà không cần chuyển đổi lại.

### Import MBTiles trực tiếp

PUT /api/geodata/v1/artifacts/import nhận file MBTiles do quản trị viên upload từ máy tính. API lưu file riêng tư, đăng ký artifact cần được đưa vào kho phục vụ, sau đó để geodata-mbtiles-store-warmer chuẩn bị như luồng thông thường. Trình duyệt không được chọn một object S3 có sẵn.

### Kho phục vụ và phát hành

Store warmer sao chép mỗi MBTiles bất biến một lần từ geodata-derived sang PVC geodata-mbtiles-data. File đích chỉ được kích hoạt bằng atomic rename, nên tile gateway không thể mở một SQLite file đang sao chép dở. Chỉ artifact đã sẵn sàng trong kho phục vụ mới được dùng để tạo release.

Vì vậy, phát hành là một chuyển đổi trạng thái catalog, không phải sao chép lại toàn bộ MBTiles và không cần restart TileServer. Gateway duy trì SQLite reader pool có giới hạn và trả trực tiếp byte tile z/x/y từ PVC.

Trạng thái phát hành:

~~~text
draft -> publishing -> published
                    \-> failed
published -> archived
~~~

Bản nháp khởi đầu ở trạng thái restricted. Với **bản đồ mới**, để selector mã bản đồ tại “bản đồ mới” và dùng version 1.0.0; GeoData sẽ sinh một mã bản đồ ổn định ngẫu nhiên ở server. Với phiên bản mới của bản đồ đã có, chọn mã bản đồ tương ứng và tăng semantic version. Điều kiện duy nhất là (map_code, version), không phải tên hiển thị. Nếu định danh sinh tự động trùng trong database, server tự thử lại.

## Chính sách truy cập

Phát hành không tự làm bản đồ restricted hiển thị cho người dùng. Trong mục **Quyền truy cập** có hai chế độ:

- **Công khai**: mọi người dùng WebGIS có thể truy cập ứng dụng bản đồ sẽ thấy và xem release.
- **Cấp quyền theo người dùng/đơn vị**: một hoặc nhiều người dùng hoặc đơn vị WebGIS nhận grant view hoặc export. Release không có grant active sẽ không xuất hiện.

Chuyển sang Công khai sẽ xoá các grant theo người dùng/đơn vị. Thiết lập grant theo người dùng/đơn vị sẽ thay thế chính sách Công khai trước đó. Khi thu hồi grant cuối cùng, map sẽ biến mất trong lần refresh catalog tiếp theo.

GET /v1/catalog là hợp đồng catalog dành cho WebGIS. Endpoint chỉ trả về map đã published, artifact đã sẵn sàng phục vụ, và thỏa một trong hai điều kiện: công khai hoặc có grant active khớp JWT sub hay đơn vị WebGIS hiện tại của người gọi. Quy tắc này áp dụng cả với tài khoản admin: quyền quản trị GeoData không mặc định là quyền xem map trong bộ chọn lớp bản đồ WebGIS. Response có Cache-Control: private, no-store và Vary: Authorization để catalog của một người dùng không thể bị dùng lại cho người khác.

Mọi request tile, TileJSON, style, sprite và preview đều được gateway kiểm tra quyền thêm một lần nữa. Catalog không phải hàng rào bảo mật duy nhất.

### Kết nối danh bạ WebGIS

GeoData sử dụng một tài khoản database WebGIS chỉ-đọc, cấu hình qua WEBGIS_DIRECTORY_DATABASE_URL. Tài khoản này chỉ đọc các trường danh bạ đang hoạt động cần cho tìm người nhận và xác định đơn vị; không được dùng lại role xác thực WebGIS, đọc password/session hoặc ghi vào database WebGIS.

| Endpoint | Mục đích |
| --- | --- |
| GET /api/geodata/v1/access/subjects | Tìm người dùng hoặc đơn vị WebGIS có thể được cấp quyền. |
| GET /api/geodata/v1/access/grants | Xem các grant hiện tại. |
| POST /api/geodata/v1/access/grants | Tạo grant view/export hoặc thiết lập chính sách Công khai. |
| POST /api/geodata/v1/access/grants/{id}/revoke | Thu hồi một grant theo người dùng/đơn vị. |

## Style, sprite và preview

Style là MapLibre v8 document bất biến. Quản trị viên có thể import style.json cùng sprite.json, sprite.png và cặp @2x nếu có, rồi chọn style khi tạo release. Gateway thay thế nguồn MBTiles nội bộ bằng endpoint tile đã được cấp quyền của release và phục vụ sprite theo cùng ACL.

Sau khi artifact nằm trong PVC phục vụ, store warmer tạo ảnh PNG 640×360 ở một object key nội bộ trong derived storage. Gateway chỉ trả /v1/releases/{slug}/artifacts/{artifactID}/preview.png sau khi kiểm tra ACL của release. WebGIS tải ảnh bằng Authorization header rồi hiển thị qua browser object URL ngắn hạn, vì thẻ img thông thường không thể tự thêm header này.

Raster MBTiles có preview tile thực tế. Vector MBTiles hiện dùng ảnh placeholder xác định trước; để render preview vector đúng địa lý cần MapLibre Native renderer kèm style, sprite và glyph, chưa được triển khai.

## Tích hợp với WebGIS

WebGIS Controller là proxy duy nhất mà trình duyệt được phép gọi đến gateway. Cấu hình GEODATA_INTERNAL_URL của Controller thành:

~~~text
http://geodata-tile-gateway.tile-server.svc.cluster.local:8091
~~~

Controller kiểm tra scope map:read, chuyển tiếp bearer token gốc tới GeoData, và proxy catalog, style, sprite, TileJSON, tile và preview. Frontend WebGIS chỉ được tải /api/geodata/catalog; không được fallback sang catalog TileServer cũ. Mở **Lớp bản đồ** hoặc bấm tải lại sẽ yêu cầu catalog mới đã lọc theo quyền. Map đang được chọn sẽ bị bỏ ở lần refresh đó nếu quyền đã bị thu hồi.

## Cấu hình bắt buộc

Các service đều cần thông tin kết nối GeoData PostgreSQL và S3 qua Kubernetes Secret. Upload API và tile gateway cũng cần JWT issuer, audience và JWKS URL của WebGIS. Gateway và store warmer phải mount cùng MBTILES_STORE_ROOT từ PVC phục vụ.

Xem manifest và câu lệnh tạo Secret chính xác tại [deployment/README.md](../deployment/README.md). Tối thiểu cần có:

- geodata-upload-s3 và geodata-worker-s3 cho quyền S3 đã giới hạn;
- geodata-upload-auth cho xác thực JWT;
- geodata-webgis-directory cho kết nối danh bạ chỉ-đọc;
- geodata-catalog-postgresql cho metadata database riêng;
- ghcr-pull trước khi Kubernetes tải image riêng tư từ GHCR.

## Triển khai và kiểm tra thay đổi API

GitHub Actions publish geodata-upload:dev, geodata-worker:dev và geodata-tile-gateway:dev khi có thay đổi trong api/**. Sau khi workflow build image hoàn tất, apply manifest nếu manifest có thay đổi, rồi restart đúng workload. Ví dụ thay đổi phân quyền hoặc gateway catalog:

~~~powershell
kubectl apply -k deployment
kubectl -n tile-server rollout restart deployment/geodata-tile-gateway
kubectl -n tile-server rollout status deployment/geodata-tile-gateway --timeout=5m
~~~

Với thay đổi upload API hoặc migration catalog:

~~~powershell
kubectl -n tile-server rollout restart deployment/geodata-upload
kubectl -n tile-server rollout status deployment/geodata-upload --timeout=5m
~~~

Upload API chạy SQL migration theo cách idempotent khi khởi động. Không chỉnh sửa thủ công lịch sử migration trong database đang vận hành. Xem deployment README để có đầy đủ quy trình cài đặt lần đầu, khôi phục SeaweedFS, xoay credential và giới hạn của môi trường một node.

## Xử lý sự cố

| Hiện tượng | Kiểm tra |
| --- | --- |
| Map restricted vẫn xuất hiện trong WebGIS | Đảm bảo gateway image mới đã rollout, rồi tải lại **Lớp bản đồ**. Kiểm tra visibility và grant active; catalog không được dùng cache dùng chung. |
| Map không xuất hiện sau khi phát hành | Kiểm tra release là published, artifact ở trạng thái sẵn sàng trong kho phục vụ, và người gọi có chính sách Công khai hoặc grant khớp. |
| a release ... map code and version already exists | Chọn “bản đồ mới” cho map logic mới. Với map cũ, tăng semantic version. Đảm bảo geodata-upload image mới nhất đang chạy. |
| Không có preview | Kiểm tra store warmer khỏe và trạng thái preview artifact đã là ready; request phải đi qua WebGIS Controller có xác thực. |
| Catalog rỗng với mọi người dùng | Kiểm tra Controller chuyển tiếp bearer token, JWT config Gateway khớp WebGIS, và kết nối danh bạ chỉ-đọc xác định được đơn vị. |
