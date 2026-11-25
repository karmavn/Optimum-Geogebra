# GeoGebra Quick Rename & 3D MCP Server (Offline Edition)

Ứng dụng Desktop (Electron) cho GeoGebra Classic với tính năng **Đổi tên điểm siêu tốc bằng một cú nhấp chuột phải**, **Tích hợp gói Web Engine Offline 100%**, và **Model Context Protocol (MCP) Server** kết nối trực tiếp với các AI Agent (Antigravity, Claude, Cursor...) để tự động vẽ hình học không gian 3D (đặc biệt là các dạng **hình chóp** theo chuẩn SGK Toán 11, 12 và đề thi THPT QG).

---

## ✨ Tính năng nổi bật

1. **MCP Server cho AI Agent**:
   - Agent gọi tool `draw_pyramid` để dựng ngay hình chóp 3D với đầy đủ tính chất hình học, đáy tam giác/tứ giác, đường cao vuông góc, nét đứt, thể tích và ảnh chụp màn hình gửi trực tiếp vào cuộc trò chuyện.
   - Hỗ trợ công cụ `geogebra_eval` để chạy bất kỳ lệnh GeoGebra nào theo ý muốn.
   - Tự động mở ứng dụng Desktop khi Agent ra lệnh vẽ nếu ứng dụng chưa chạy.
2. **100% Offline độc lập**:
   - Toàn bộ lõi toán học HTML5/Canvas/WebGL của GeoGebra được tích hợp sẵn cục bộ (`geogebra-offline/`), không cần mạng Internet.
3. **Chuột phải đổi tên ngay (Quick Rename)**:
   - Nhấp chuột phải trực tiếp vào bất kỳ điểm nào trên bảng vẽ để mở ô nhập tên mới ngay lập tức.
   - Gợi ý sẵn các chip tên điểm hình học thông dụng (`M`, `H`, `O`, `I`, `K`, `A'`, `B'`...).
4. **Tối ưu 60 FPS & Hiệu năng cao**:
   - Render 3D mượt mà, điều phối resize bằng `requestAnimationFrame`, không giật lag.
5. **Mở & Lưu tệp `.ggb` cục bộ**:
   - Hỗ trợ phím tắt Ctrl+O, Ctrl+S và lưu tệp thông qua MCP.

---

## 🤖 Danh sách công cụ MCP (MCP Tools)

| Tên công cụ | Mô tả |
| :--- | :--- |
| `draw_pyramid` | **Dựng hình chóp 3D chuyên sâu**: Hỗ trợ chóp tam giác ($S.ABC$), chóp tứ giác ($S.ABCD$), chóp đều, $SA \perp đáy$, $SH \perp đáy$ với $H$ là trung điểm/trọng tâm, tùy biến kích thước, nét đứt, độ trong suốt và trả về ảnh chụp màn hình 3D. |
| `geogebra_eval` | Chạy danh sách các lệnh GeoGebra tùy ý (ví dụ: `A = (0,0,0)`, `Pyramid(A,B,C,S)`...). |
| `geogebra_screenshot` | Chụp ảnh màn hình không gian 3D/2D hiện tại và trả về ảnh PNG Base64. |
| `geogebra_get_objects` | Lấy danh sách tất cả các điểm, đoạn thẳng, đa giác, khối chóp cùng tọa độ và giá trị. |
| `geogebra_clear` | Xóa sạch bảng vẽ để bắt đầu bài toán mới. |
| `geogebra_set_view` | Chuyển đổi góc nhìn 3D/2D, ẩn/hiện hệ trục tọa độ, lưới nền. |
| `geogebra_save` | Lưu bài vẽ hiện tại thành file `.ggb`. |
| `geogebra_load` | Mở file `.ggb` từ ổ đĩa. |
| `geogebra_open_app` | Đưa cửa sổ GeoGebra Desktop lên trên màn hình. |

---

## 📐 Các dạng hình chóp được hỗ trợ trong `draw_pyramid`

* **Đáy tam giác (`type: 'tam_giac'`)**:
  - `tam_giac_vuong_A`, `tam_giac_vuong_B`, `tam_giac_vuong_C`: Tam giác vuông với 2 cạnh góc vuông tùy chỉnh.
  - `tam_giac_deu`: Tam giác đều cạnh $a$.
  - `tam_giac_can`: Tam giác cân tại $A$ với đáy $a$ và cạnh bên $b$.
  - `tam_giac_thuong`: Tam giác thường.
* **Đáy tứ giác (`type: 'tu_giac'`)**:
  - `hinh_vuong`: Hình vuông cạnh $a$.
  - `hinh_chu_nhat`: Hình chữ nhật $a \times b$.
  - `hinh_thoi`: Hình thoi cạnh $a$ (góc $60^\circ$).
  - `hinh_binh_hanh`: Hình bình hành $a \times b$.
  - `hinh_thang_vuong`: Hình thang vuông tại $A$ và $B$ (đáy lớn $2b$, đáy nhỏ $b$, chiều cao $a$).
* **Vị trí đường cao (`height_type`)**:
  - `SA_vuong_goc_day`, `SB_vuong_goc_day`, `SC_vuong_goc_day`: Cạnh bên vuông góc với mặt phẳng đáy.
  - `chop_deu` / `SO_chop_deu`: Đỉnh chóp chiếu xuống tâm đáy $O$ (chóp đều tam giác hoặc chóp đều tứ giác).
  - `SH_trung_diem_AB`: Mặt bên $(SAB)$ vuông góc đáy, tam giác $SAB$ cân tại $S$.
  - `SH_trung_diem_AD`: Mặt bên $(SAD)$ vuông góc đáy, tam giác $SAD$ cân tại $S$.
  - `SH_trong_tam`: Đường cao hạ từ đỉnh xuống trọng tâm đáy.
* **Điểm phụ & Mặt phẳng (`extra_points`, `planes`)**:
  - Tự động lấy trung điểm (ví dụ $M$ là trung điểm $SC$).
  - Dựng mặt phẳng thiết diện (ví dụ $(AMN)$).

---

## 🚀 Cách kết nối và khởi chạy

### 1. Cấu hình MCP trong `~/.gemini/config/mcp_config.json`
Đã được đăng ký sẵn:
```json
{
  "mcpServers": {
    "geogebra": {
      "command": "node",
      "args": [
        "<path-to-repo>\\mcp-server.js"
      ]
    }
  }
}
```

### 2. Mở ứng dụng Desktop bằng tay (Tùy chọn)
Nếu không mở trước, MCP Server sẽ tự động khởi động ứng dụng khi nhận được lệnh vẽ từ Agent:
```powershell
npm start
```

### 3. Ra lệnh cho Agent vẽ hình chóp:
Ví dụ câu lệnh:
- *"Vẽ hình chóp tam giác S.ABC có đáy là tam giác vuông tại B, cạnh bên SA vuông góc với đáy"*
- *"Vẽ hình chóp tứ giác đều S.ABCD có đáy hình vuông cạnh 4, chiều cao bằng 6, M là trung điểm SC"*
- *"Vẽ hình chóp S.ABCD có đáy là hình chữ nhật, SA vuông góc với (ABCD)"*
