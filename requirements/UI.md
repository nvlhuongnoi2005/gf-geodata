# Đặc tả hiển thị UI — GeoForge

## 1. Mục tiêu trải nghiệm

UI phục vụ quản trị viên vận hành dữ liệu bản đồ. Giao diện phải cho biết rõ
trạng thái dữ liệu, tiến trình chuyển đổi, bản phát hành và mức sẵn sàng của
hệ thống, nhưng không làm lộ chi tiết hạ tầng nội bộ.

Ngôn ngữ hiển thị ưu tiên là tiếng Việt, có thể chuyển sang tiếng Anh. Các
thông điệp phải nhất quán, ngắn gọn và hướng vào nghiệp vụ: **dữ liệu nguồn**,
**chuyển đổi**, **bản phát hành**, **quyền truy cập**.

## 2. Nguyên tắc hiển thị an toàn cho môi trường production

Không hiển thị trên giao diện người dùng:

- tên sản phẩm hoặc phiên bản công nghệ đang vận hành;
- bucket name, URI object storage, endpoint, IP, topology cluster hay tên pod;
- access key, secret, JWT claim, raw request/response hoặc thông tin cấu hình;
- chi tiết log hệ thống có thể làm lộ cấu trúc hạ tầng.

Thay vào đó, dùng diễn đạt theo mức bảo mật và trạng thái nghiệp vụ, ví dụ:
“Lưu trữ riêng tư”, “Dữ liệu được bảo vệ”, “Hạ tầng lưu trữ sẵn sàng”,
“Đã kiểm toán và phiên bản hóa”. Chi tiết kỹ thuật chỉ được xem trong màn hình
quản trị/vận hành được phân quyền riêng trong tương lai.

## 3. Trang Dashboard

### 3.1. Vai trò

Dashboard là trang overview tĩnh theo thời điểm, không phải trang điều hướng.
Không đặt nút, hyperlink hoặc CTA dẫn đến các trang Dataset, Pipeline, Style
hoặc Release vì thanh điều hướng bên trái đã đảm nhiệm chức năng này.

### 3.2. Thẻ tổng quan

Hiển thị bốn thẻ cùng cấp theo grid responsive. Giá trị là thông tin mẫu cho
giai đoạn demo; sau này lấy từ API tổng hợp trạng thái.

| Thẻ | Giá trị chính | Mô tả phụ |
| --- | --- | --- |
| Dataset quản lý | `4 datasets` | `7.8 GB dữ liệu nguồn đang được lưu trữ an toàn` |
| Job đang xử lý | `1 đang chạy / 4` | `Hệ thống chuyển đổi đang hoạt động ổn định` |
| Lưu trữ dữ liệu | `Lưu trữ riêng tư` | `Cụm riêng biệt, không kết nối Internet; 2 vùng dữ liệu đang hoạt động` |
| Map releases | `3 Live Releases` | `Catalog WebGIS được đồng bộ quyền truy cập` |

Không dùng các nhãn “SeaweedFS”, “S3”, tên worker, phiên bản GDAL, JWT claims
hoặc số bucket trên Dashboard. Các thông tin này không giúp người vận hành ra
quyết định nhanh và có thể tiết lộ cấu trúc hạ tầng.

### 3.3. System health

Chỉ hiển thị một thẻ **Tình trạng hệ thống** với ba hàng trạng thái:

| Dịch vụ | Trạng thái mẫu |
| --- | --- |
| Dịch vụ xác thực | Sẵn sàng |
| Hạ tầng lưu trữ | Sẵn sàng |
| Tile gateway | Sẵn sàng |

Mỗi hàng dùng chấm trạng thái xanh và chữ “Sẵn sàng”. Không hiển thị tên
`db-auth`, tên storage backend hay trạng thái nội bộ như endpoint/port.

### 3.4. Nội dung loại bỏ

- Bỏ hoàn toàn khối **Platform setup**.
- Bỏ progress bar setup, các bước “kết nối storage”, “tạo dataset đầu tiên”,
  “publish map release” và mọi CTA liên quan.
- Bỏ nút “View pipeline”, “Add dataset”, “Open data workspace” khỏi Dashboard.

## 4. Trang Source Data

### 4.1. Vai trò

Trang này quản lý catalog dữ liệu nguồn và các phiên bản của chúng. Đây không
phải là trang mô tả hạ tầng lưu trữ.

Tiêu đề: **Dữ liệu nguồn**  
Mô tả: **Quản lý dữ liệu nguồn, phiên bản và trạng thái sẵn sàng trước khi chuyển đổi.**

Các hành động đầu trang:

- **Import nội bộ**: tiếp nhận dữ liệu đã có trong mạng nội bộ.
- **Tải lên dữ liệu**: tạo dữ liệu nguồn mới và bắt đầu upload có thể tiếp tục.

### 4.2. Nội dung loại bỏ

Không hiển thị các nội dung sau:

- “Lưu trữ SeaweedFS S3”, “Air-gapped Object Storage”;
- `s3://raw-datasets`, bucket path, endpoint hoặc mô tả raw/derived bucket;
- tên công nghệ lưu trữ, worker, GDAL hoặc thông số hạ tầng.

Không dùng cụm “GDAL job”. Khi người dùng chọn một phiên bản dữ liệu nguồn,
hành động nghiệp vụ phải là **Tạo tác vụ chuyển đổi**. Hệ thống sẽ tự chọn
worker tương thích ở backend; UI chỉ hiển thị loại chuyển đổi, cấu hình, tiến
trình và kết quả.

### 4.3. Thông tin hiển thị

Danh sách dữ liệu nguồn nên có các cột:

| Cột | Nội dung |
| --- | --- |
| Dataset | Tên, mô tả ngắn và tag nghiệp vụ |
| Định dạng | Ví dụ: OSM PBF, GeoTIFF, GeoPackage, Shapefile, MBTiles |
| Phiên bản mới nhất | Mã/version và thời điểm cập nhật |
| Dung lượng | Kích thước phiên bản hiện tại |
| Trạng thái | Sẵn sàng, đang tải lên, cần kiểm tra, đã lưu trữ |
| Hành động | Xem chi tiết, tạo tác vụ chuyển đổi, archive |

Trong trang chi tiết dataset, có thể hiển thị metadata nghiệp vụ như checksum,
CRS, bounds, số layer/band, nguồn, license và lịch sử phiên bản.

Hai badge bảo mật/nghiệp vụ được giữ ở phần thông tin dataset:

- **Dữ liệu nguồn bất biến**
- **Đã kiểm toán và phiên bản hóa**

Không kèm mô tả bucket hay đường dẫn lưu trữ bên cạnh các badge này.

### 4.4. Empty state

Khi chưa có dataset, hiển thị:

- tiêu đề: **Chưa có dữ liệu nguồn**;
- mô tả: **Tải lên hoặc import OSM PBF, GeoTIFF, GeoPackage, Shapefile hay MBTiles để bắt đầu.**;
- một nút chính: **Tải lên dữ liệu**;
- các chip định dạng chỉ mang tính gợi ý, không thể hiện thông tin hạ tầng.

## 5. Trang Pipeline/Convert Data

Tên hiển thị: **Chuyển đổi dữ liệu**.

Người dùng chọn một raw data version từ catalog, sau đó chọn cấu hình đầu ra
như định dạng, phạm vi, layer và mức zoom. UI gọi đây là **tác vụ chuyển đổi**
hoặc **job chuyển đổi**, không nêu tên implementation worker.

Mỗi job hiển thị: input version, cấu hình, tiến trình, thời gian bắt đầu, trạng
thái, kết quả, lỗi thân thiện với người dùng và lựa chọn retry/cancel khi được
phép. Log kỹ thuật chi tiết chỉ hiển thị cho người có quyền vận hành phù hợp.

## 6. Typography và mật độ thông tin

Giao diện phải có mật độ vừa phải, ưu tiên thao tác vận hành dài ngày thay vì
dashboard marketing.

| Thành phần | Kích thước khuyến nghị |
| --- | --- |
| Tiêu đề trang | 26–28 px, đậm vừa |
| Tiêu đề thẻ/section | 16–18 px |
| Giá trị metric Dashboard | 22–24 px, không dùng heading display quá lớn |
| Nội dung chính | 14–16 px |
| Nhãn, metadata, trạng thái | 12–13 px |

Ví dụ `4 datasets`, `1 đang chạy / 4` và `3 Live Releases` phải dùng cỡ metric
22–24 px; không dùng `h4`/`h3` hoặc font-size marketing gây mất cân đối.

Trên màn hình nhỏ, các thẻ overview chuyển thành một cột; nút hành động được
wrap, không che nội dung và không buộc người dùng cuộn ngang.

## 7. Accessibility và trạng thái UX

- Mỗi icon button phải có `aria-label` và tooltip.
- Không để nút trông như khả dụng khi backend chưa hỗ trợ; hiển thị disabled
  kèm lời giải thích ngắn hoặc ẩn khỏi UI.
- Không hiển thị “Connected”, “Ready” hay số liệu giả định ở production nếu
  chưa nhận được health/summary từ API.
- Empty, loading, error và no-access state phải có thông điệp rõ ràng, có hành
  động tiếp theo phù hợp.
- Các trạng thái màu phải luôn có text đi kèm; không dựa hoàn toàn vào màu sắc.
