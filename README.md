# Viettel Đồng Nai · Nguyễn Thị Hồng Thoại

Website Next.js với trang khách từ bản gốc và `/admin` quản lý nội dung, báo giá và yêu cầu tư vấn.

## Chạy cục bộ

Dùng Node.js 22. Chạy trong thư mục dự án.

~~~powershell
npm ci
Copy-Item .env.example .env.local
~~~

Điền biến môi trường vào `.env.local` rồi chạy.

~~~powershell
npm run db:init
npm run dev
~~~

Mở [trang khách](http://localhost:3000) và [trang quản trị](http://localhost:3000/admin). Lệnh khởi tạo giữ các mục đã lưu trong Neon khi chạy lại.

## Biến môi trường

| Biến | Dùng cho |
|---|---|
| `DATABASE_URL` | Kết nối Neon của chị Thoại. Khởi tạo từng database dùng cho Preview hoặc Production. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` | Tên đăng nhập và hash mật khẩu quản trị. |
| `BLOB_READ_WRITE_TOKEN` | Token từ kho Vercel Blob Public của project. Admin dùng để tải ảnh WebP. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | API key và địa chỉ gửi thuộc domain đã xác minh trong Resend. Email nhận yêu cầu chỉnh trong Admin → Liên hệ, mặc định là `thoainth1@viettel.com.vn`. |

Tạo hash trên PowerShell 7 bằng lệnh sau.

~~~powershell
Read-Host -MaskInput 'Mật khẩu quản trị 12–200 ký tự' | npm run --silent admin:hash
~~~

## Quản trị nội dung

- **Liên hệ** có email công khai và email nhận yêu cầu, hotline, địa chỉ, chữ chạy, ảnh đại diện, ảnh cửa hàng và QR TAMMI. Bấm **Lưu ảnh này** sau khi tải lên. Thanh chữ chạy lấy địa chỉ và hotline từ phần liên hệ.
- **Trang chủ** lưu từng phần như menu, giới thiệu, dịch vụ, Góc khám phá và đăng ký tư vấn.
- **Dịch vụ** dùng **Lưu mục này** để xuất bản mục đang mở. Có thể lưu riêng ảnh của dịch vụ đã xuất bản. Để trống đường dẫn khi tạo dịch vụ mới để tự lấy từ tên. **Lưu danh sách** áp dụng thứ tự, ẩn và xóa đã chọn.
- **Báo giá** theo từng dịch vụ, có lưu từng gói. Form sẽ báo khi gói vừa ẩn hoặc xóa. Yêu cầu đã lưu giữ tên và giá tại thời điểm gửi.
- **Video** nhận ID YouTube, URL video, playlist và MP4. Bảy video gốc gồm cả video hướng dẫn TAMMI và MP4 FTTH trong mã nguồn.
- **Yêu cầu tư vấn** có trạng thái xử lý, trạng thái mail và **Xuất Excel**. Ngày lọc tính theo giờ Việt Nam, gồm cả ngày đầu và cuối. Bỏ trống hai ô để xuất tất cả.

Khi khách gửi, yêu cầu vào Neon và được trả mã. Email cho chị Thoại và email xác nhận cho khách được gửi riêng. Khi email lỗi, admin vẫn thấy yêu cầu cùng trạng thái gửi.

## Vercel Preview riêng

1. Đẩy toàn bộ mã nguồn thư mục này lên repo chị Thoại. Import repo trong project Vercel riêng với preset Next.js.
2. Trong **Settings → Deployment Protection**, bật **Vercel Authentication** cho Preview và xác nhận bằng cửa sổ chưa đăng nhập. [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection)
3. Thêm biến môi trường cho Preview và khởi tạo nhánh Neon dùng để thử. Kết nối Blob và Resend trong cùng project. Dùng dữ liệu mẫu và hộp thư thử để kiểm tra form, hai email, admin và file Excel.
4. Sau khi duyệt Preview, cấu hình Production, khởi tạo Neon Production rồi triển khai và gán tên miền.

## Đối chiếu dữ liệu gốc

Bản khởi tạo giữ 6 dịch vụ, 159 mục báo giá, 7 video và 4 lựa chọn bổ sung trong form. S-Invoice dùng 36 mục từ popup thực tế đang được nối với nút báo giá.

Bản gốc của vContract có mục `VCONT_10K` hiển thị số lượng hợp đồng là 0. Popup vBHXH gốc có ghi chú VAT khác nhau giữa một số thẻ và phần mô tả chung. Đối chiếu các dòng này với bảng giá được duyệt trước khi công bố.
