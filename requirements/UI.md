# Requirements — Hệ thống quản trị Geodata cho `map`

## 1. Mục tiêu

Xây dựng `ms-geodata` là hệ thống quản trị tập trung dữ liệu bản đồ cho project `map`. Hệ thống cho phép admin upload dữ liệu lớn trong môi trường offline, xử lý thành tileset, quản lý style, kiểm soát quyền xem theo user/nhóm và publish map vào ứng dụng `map`.

Hệ thống không thay thế `map` hoặc `db-auth` hiện tại:

- `map` tiếp tục là ứng dụng hiển thị và sử dụng bản đồ.
- `db-auth` tiếp tục là nguồn identity, session và quyền admin.
- `ms-geodata` sở hữu metadata geodata, pipeline xử lý, style, publication và ACL dữ liệu bản đồ.

## 2. Đối tượng sử dụng

| Vai trò | Quyền |
| --- | --- |
| Admin | Toàn quyền upload, xử lý, quản lý style, phân quyền và publish. |
| Map user | Chỉ xem các map/layer đã được cấp quyền. |
| System worker | Chạy job xử lý geodata; không có quyền đăng nhập UI. |

## 3. Yêu cầu chức năng

### 3.1. Tích hợp xác thực

- FR-01: Chỉ user có role `admin` từ `db-auth` được truy cập trang quản trị geodata.
- FR-02: Geodata không quản lý tài khoản, mật khẩu, access token hoặc refresh token riêng.
- FR-03: Geodata sử dụng JWT do auth service của `map` cấp để nhận diện user qua claim `sub`.
- FR-04: Khi user bị disable, logout hoặc token hết hạn, họ không được truy cập dữ liệu restricted.
- FR-05: Mọi hành động quản trị phải ghi nhận user thực hiện, thời điểm và tài nguyên bị tác động.

### 3.2. Quản lý raw geodata

- FR-06: Admin tạo Dataset với tên, mô tả, loại dữ liệu, nguồn, license và tags.
- FR-07: Admin upload file lớn theo cơ chế resume/multipart.
- FR-08: Hệ thống hỗ trợ import dữ liệu đã có trong mạng nội bộ mà không bắt buộc upload qua browser.
- FR-09: Hệ thống lưu raw asset theo version; upload mới không được ghi đè raw asset cũ.
- FR-10: Hệ thống hiển thị metadata sau upload: định dạng, dung lượng, CRS, bounds, số layer/band, checksum và trạng thái.
- FR-11: Admin có thể archive raw version; không được xóa vật lý ngay nếu version đó đang được một publication sử dụng.

### 3.3. Pipeline xử lý

- FR-12: Admin có thể tạo processing job từ một raw asset version.
- FR-13: Hệ thống phải kiểm tra file trước khi xử lý: file type, CRS, bounds, dung lượng, layer và lỗi đọc dữ liệu.
- FR-14: Hệ thống phải hỗ trợ các bước GDAL: reproject, optimize, overview, simplify/filter khi được cấu hình.
- FR-15: Hệ thống tạo tileset version độc lập với raw asset version.
- FR-16: Hệ thống lưu log, tiến độ, lỗi, thời gian chạy, input/output size của từng job.
- FR-17: Admin có thể retry job thất bại và hủy job chưa hoàn tất.
- FR-18: Chỉ tileset version đạt validation mới có trạng thái `ready` để preview hoặc publish.

### 3.4. Quản lý style

- FR-19: Admin tạo, sửa, clone, xem version history và rollback style.
- FR-20: Admin chỉnh sửa `style.json` bằng JSON editor có format, validate và thông báo lỗi theo dòng.
- FR-21: Admin preview trực tiếp basemap/tileset với style đang chỉnh sửa.
- FR-22: Style draft không được làm thay đổi map đang public.
- FR-23: Style version phải tham chiếu rõ source/layer tileset tương thích.

### 3.5. Tạo map và chọn dữ liệu đưa vào map

- FR-24: Admin tạo Map Release gồm tên, slug, mô tả, trạng thái và style version.
- FR-25: Một Map Release có thể gồm một basemap và nhiều overlay.
- FR-26: Admin chọn tileset version/layer nào được thêm vào Map Release.
- FR-27: Với vector data, admin có thể cấu hình layer hoặc filter dữ liệu được xuất hiện trong Map Release.
- FR-28: Dữ liệu public và restricted không được gộp vào cùng tileset artifact nếu điều đó có thể làm lộ feature restricted.
- FR-29: Map Release có preview trước publish.
- FR-30: Admin có thể publish, unpublish và rollback Map Release sang version đã từng publish.

### 3.6. Phân quyền xem geodata

- FR-31: Mỗi Map Release hoặc layer trong Map Release có visibility: `public`, `authenticated`, hoặc `restricted`.
- FR-32: Admin cấp quyền `view` cho user cụ thể dựa trên UUID `sub` từ `db-auth`.
- FR-33: Hệ thống phải hỗ trợ cấp quyền theo group/organization khi `db-auth` cung cấp khái niệm này.
- FR-34: User chỉ thấy catalog gồm các Map Release mà họ có quyền xem.
- FR-35: Hệ thống kiểm tra quyền ở lúc trả catalog, style, TileJSON, sprite và tile; không chỉ kiểm tra ở UI.
- FR-36: Thu hồi quyền phải có hiệu lực với các request mới ngay sau khi policy được cập nhật.
- FR-37: Admin có thể xem danh sách principal đang được cấp quyền cho một Map Release.

### 3.7. Tích hợp với `map`

- FR-38: Giữ tương thích endpoint hiện có: `/api/tile-catalog` và `/api/tiles/*`.
- FR-39: Catalog trả metadata đủ để frontend `map` render raster/vector basemap và overlay.
- FR-40: Map `public` vẫn hoạt động không yêu cầu đăng nhập.
- FR-41: Map restricted yêu cầu access token hợp lệ từ auth service hiện tại.
- FR-42: Không để browser truy cập trực tiếp object storage hoặc credential storage. Ngoại lệ duy nhất là URL multipart presigned ngắn hạn để upload raw vào một key staging đã định; URL này không cấp quyền list, read tile/style hoặc access key.
- FR-43: User không có quyền không thể truy cập artifact tile bằng URL đã biết.

## 4. Yêu cầu phi chức năng

- NFR-01: Hệ thống vận hành không cần Internet tại runtime.
- NFR-02: Container image, GDAL dependency, font, glyph, sprite và basemap asset phải có thể triển khai trong môi trường air-gapped.
- NFR-03: Raw data và output phải lưu trên SeaweedFS S3-compatible nội bộ; database chỉ lưu metadata.
- NFR-04: Pipeline phải xử lý bất đồng bộ; request upload/publish không bị block bởi GDAL.
- NFR-05: Raw file, tileset, style và Map Release phải có version, checksum và audit trail.
- NFR-06: Tile runtime không chạy GDAL hoặc convert dữ liệu trên request path.
- NFR-07: Restricted tile không được cache shared theo cách có thể trả data của user A cho user B.
- NFR-08: Worker có giới hạn CPU, RAM, disk scratch, thời gian chạy và số job song song.
- NFR-09: Hệ thống có health check, metrics, structured logs và cảnh báo job thất bại.
- NFR-10: Các tile/style URL đã public phải ổn định khi admin publish version mới; rollback không yêu cầu convert lại.
- NFR-11: Ở topology Kubernetes một node, object storage không được quảng cáo HA; dữ liệu SeaweedFS phải nằm trên persistent volume và được backup sang một failure domain khác.

## 5. Ngoài phạm vi giai đoạn đầu

- Chỉnh sửa trực tiếp feature geometry trong browser.
- Realtime collaborative GIS editing.
- Public self-service upload cho user thường.
- Billing/quota chi tiết theo từng tileset.
- Multi-region replication hoặc Internet CDN.

## 6. Tiêu chí nghiệm thu MVP

MVP được xem là đạt khi:

1. Admin đăng nhập bằng auth hiện tại và vào được Geodata Admin.
2. Admin upload/import một GeoTIFF hoặc GeoPackage lớn.
3. Hệ thống tạo job GDAL, hiển thị tiến độ và sinh tileset hợp lệ.
4. Admin preview tileset, chỉnh `style.json`, lưu style version.
5. Admin tạo Map Release, chọn basemap/overlay và publish.
6. Admin cấp map cho một user A nhưng không cấp user B.
7. User A thấy và tải tile thành công trong ứng dụng `map`.
8. User B không thấy map trong catalog và bị từ chối nếu gọi tile URL trực tiếp.
9. Admin rollback về publication trước đó mà không chạy lại conversion.
10. Dataset cũ của tile-server hiện tại vẫn tiếp tục hoạt động qua các endpoint cũ.
