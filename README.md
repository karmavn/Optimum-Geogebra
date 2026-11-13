# GeoGebra Quick Rename Edition (100% Offline Desktop)

Ứng dụng Desktop (Electron) cho GeoGebra Classic với tính năng **Đổi tên điểm siêu tốc bằng một cú nhấp chuột phải** và **Tích hợp gói Web Engine Offline 100%**.

## ✨ Tính năng nổi bật
* **100% Offline độc lập**: Toàn bộ lõi toán học HTML5/Canvas/WebGL của GeoGebra được tích hợp sẵn cục bộ (`geogebra-offline/`), khởi động tức thì, hoạt động mượt mà không cần kết nối Internet ngay cả trong lần chạy đầu tiên.
* **Chuột phải đổi tên ngay**: Thay vì phải nhấp chuột phải ➔ bấm dấu 3 chấm ➔ chọn Đổi tên, giờ đây bạn chỉ cần **nhấp chuột phải vào bất kỳ điểm nào** để mở ngay ô nhập tên mới.
* **Gợi ý tên thông minh**: Cung cấp sẵn các chip tên điểm hình học thông dụng (`M`, `H`, `O`, `I`, `K`, `A'`, `B'`...) để chọn nhanh bằng 1 click.
* **Tối ưu 60 FPS**: Tự động điều phối hiệu năng qua `requestAnimationFrame`, không giật lag khi thay đổi kích thước cửa sổ, không nháy trắng lúc khởi động.
* **Tích hợp Native File System**: Hỗ trợ mở và lưu file `.ggb` trực tiếp từ ổ đĩa qua Menu **Tệp (Ctrl+O, Ctrl+S)**.
* **Giữ nguyên 100% công cụ**: Đầy đủ thanh công cụ vẽ hình học phẳng, đồ thị hàm số, đại số CAS, 3D...

---

## 🚀 Hướng dẫn khởi chạy

```powershell
cd C:\Users\Admin\.gemini\antigravity\scratch\geogebra-quick-rename
npm start
```

## 📦 Đóng gói ra file cài đặt Desktop (.exe)
```powershell
npm run dist
```
File cài đặt `.exe` độc lập sẽ được tạo trong thư mục `dist/`.
