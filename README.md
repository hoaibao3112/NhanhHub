# 🚀 Dự Án Kết Nối Nhanh.vn Open API v3.0

Chào anh Hưng! Dưới đây là tóm tắt toàn bộ những tính năng "xịn sò" mà hệ thống đã hoàn thiện để kết nối và đồng bộ dữ liệu với nền tảng Nhanh.vn.

## 🌟 Những gì đã làm được (Milestones)

### 1. Hệ Thống OAuth 2.0 Hoàn Chỉnh
- **Kết nối tự động:** Xây dựng luồng Redirect sang Nhanh.vn để người dùng xác thực ứng dụng.
- **Trao đổi Token:** Tự động nhận `accessCode` và đổi sang `accessToken` dài hạn (v3.0).
- **Lưu trữ thông minh:** Token được mã hóa và lưu tại `nhanh_token.json`, tự động khôi phục khi khởi động lại Server.

### 2. Quản Lý Sản Phẩm (Product Management)
- **Lấy danh sách:** API truy xuất toàn bộ sản phẩm từ kho Nhanh.vn về hệ thống.
- **Tạo sản phẩm mới:** Hỗ trợ đẩy sản phẩm từ App lên Nhanh.vn (tương thích hoàn toàn chuẩn JSON v3.0).

### 3. Quản Lý Đơn Hàng (Order Management)
- **Tạo đơn hàng:** Hỗ trợ tạo đơn hàng mới với đầy đủ thông tin khách hàng, sản phẩm và ghi chú.
- **Xử lý địa chính:** Tích hợp API tra cứu ID Tỉnh/Thành, Quận/Huyện để đảm bảo tạo đơn hàng không bao giờ bị lỗi địa chỉ.

### 4. Bảo Mật Cấp Cao (Security)
- **Lớp bảo vệ Guard:** Đã triển khai `NhanhAuthGuard` để bảo vệ toàn bộ API.
- **Mã bảo mật riêng:** Chỉ những người có mã bí mật (`x-api-key`) mới có quyền thao tác. 
  - *Mã hiện tại:* `anhhungdeptrai` (Cấu hình tại `.env`).

---

## 🛠 Hướng dẫn sử dụng nhanh cho Anh Hưng

### Bước 1: Kết nối tài khoản
Truy cập: `http://localhost:3000/nhanh/connect` để liên kết App với cửa hàng Nhanh.vn của anh.

### Bước 2: Sử dụng API trong Postman
Để gọi bất kỳ API nào (lấy sản phẩm, tạo đơn...), anh cần thêm vào phần **Headers** của Postman:
- **Key:** `x-api-key`
- **Value:** `anhhungdeptrai`

### Bước 3: Danh sách các Endpoint quan trọng
| Chức năng | Phương thức | Đường dẫn (URL) |
| :--- | :---: | :--- |
| **Kiểm tra kết nối** | `GET` | `/nhanh/status` |
| **Lấy sản phẩm** | `GET` | `/nhanh/products` |
| **Tạo sản phẩm** | `POST` | `/nhanh/products` |
| **Tạo đơn hàng** | `POST` | `/nhanh/orders` |
| **Tra cứu Tỉnh/Thành** | `GET` | `/nhanh/cities` |
| **Tra cứu Quận/Huyện** | `GET` | `/nhanh/districts?cityId=XXX` |
| **Ngắt kết nối** | `DELETE`| `/nhanh/disconnect` |

---

## 🛡 Bảo trì & Phát triển
- **Token:** Token v3.0 có thời hạn 1 năm. Nếu hết hạn, chỉ cần bấm lại link `connect`.
- **Mã bảo mật:** Anh có thể đổi mã `anhhungdeptrai` sang mã khác trong file `.env` (biến `NHANH_INTERNAL_KEY`).

