# GeoData API contract

Nguồn hợp đồng chính thức là [openapi.yaml](openapi.yaml). API chưa được triển khai
trong repository này; frontend và backend phải cùng bám vào file đó trước khi nối dữ liệu thật.

## Quy ước bắt buộc

- Base path: `/api/geodata/v1`; identity do WebGIS hiện hữu cấp, còn GeoData API chỉ xác thực và phân quyền.
- Request thay đổi trạng thái cần Bearer token và quyền quản trị. Nếu dùng cookie session, gateway phải bổ sung CSRF protection tương đương.
- IDs là UUID, thời gian là RFC 3339 UTC, list dùng cursor opaque (`nextCursor`) thay vì page offset.
- Lỗi trả `application/problem+json` theo RFC 9457, có mã máy đọc được ở `code`.
- Không trả bucket, object key, storage credential hoặc URL nội bộ. Upload multipart chỉ nhận URL ký ngắn hạn, scope vào một version.
- Dataset version, style version và artifact là bất biến. Release được tạo ở `draft`, chỉ publish khi toàn bộ dependency hợp lệ.

## Trình tự tích hợp đầu tiên

1. Backend thực hiện `GET /summary`, `GET/POST /datasets`, version và upload session.
2. Frontend nối `DatasetsPage` với những endpoint này, thay `VITE_GEODATA_UPLOAD_URL` bằng flow `/uploads`.
3. Thêm job worker và các endpoint `/jobs`; sau đó mới bật tạo/chạy/retry/cancel trên UI.
4. Lần lượt triển khai style, release, ACL và audit.

`openapi.yaml` có thể được đưa vào OpenAPI Generator hoặc Swagger UI khi backend stack đã được chọn.
