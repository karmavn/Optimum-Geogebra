#!/usr/bin/env node
/**
 * GeoGebra 3D MCP Server
 * Connects AI agents to the GeoGebra Desktop application to draw 3D geometry (hình chóp, lăng trụ, v.v.)
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const path = require('path');
const { spawn, execFile } = require('child_process');

const PORT = parseInt(process.env.GEOGEBRA_MCP_PORT, 10) || 3999;
const BRIDGE_URL = `http://127.0.0.1:${PORT}`;
const APP_DIR = path.resolve(__dirname);

let isLaunching = false;

async function isBridgeReady(timeout = 2500) {
  try {
    const res = await fetch(`${BRIDGE_URL}/status`, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return false;
    const data = await res.json();
    return !!(data.running && data.appletReady);
  } catch (e) {
    return false;
  }
}

async function ensureAppRunning(timeoutMs = 25000) {
  if (await isBridgeReady(1200)) return true;

  if (!isLaunching) {
    isLaunching = true;
    try {
      if (process.platform === 'win32') {
        execFile('schtasks', ['/run', '/tn', 'LaunchGeoGebraOnDesktop'], (err) => {
          if (err) {
            const batPath = path.join(APP_DIR, 'start-geogebra.bat');
            const psScript = `$action = New-ScheduledTaskAction -Execute '${batPath.replace(/'/g, "''")}'; $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; Register-ScheduledTask -TaskName 'LaunchGeoGebraOnDesktop' -Action $action -Settings $settings -Force | Out-Null; Start-ScheduledTask -TaskName 'LaunchGeoGebraOnDesktop';`;
            spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
              detached: true,
              stdio: 'ignore'
            }).unref();
          }
        });
      } else {
        const runScript = path.join(APP_DIR, 'run-electron.js');
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(process.execPath, [runScript], {
          cwd: APP_DIR,
          env,
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
      }
    } catch (err) {
      isLaunching = false;
      throw new Error(`Không thể khởi chạy ứng dụng GeoGebra: ${err.message}`);
    }
  }

  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, 600));
    if (await isBridgeReady(1000)) {
      isLaunching = false;
      return true;
    }
  }

  isLaunching = false;
  throw new Error('Ứng dụng GeoGebra đang khởi động quá thời gian chờ (25 giây). Vui lòng thử lại lệnh.');
}

async function requestBridge(endpoint, method = 'GET', body = null) {
  await ensureAppRunning();
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Connection': 'keep-alive'
    },
    signal: AbortSignal.timeout(30000)
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${BRIDGE_URL}${endpoint}`, options);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GeoGebra Bridge Error (${res.status}): ${errText}`);
  }
  return await res.json();
}

function cleanBase64(base64Str) {
  if (!base64Str) return '';
  return base64Str.replace(/^data:image\/[a-z]+;base64,/, '');
}

// Khởi tạo MCP Server
const server = new McpServer({
  name: 'geogebra-3d-server',
  version: '1.0.0'
});

// =========================================================================
// TOOL 1: draw_pyramid (VẼ HÌNH CHÓP 3D)
// =========================================================================
server.tool(
  'draw_pyramid',
  'Vẽ hình chóp không gian 3D trong GeoGebra (hình chóp tam giác S.ABC, tứ giác S.ABCD, chóp đều, SA vuông góc đáy, SH trung điểm, v.v.) chuẩn theo chương trình Toán THPT Việt Nam (Toán 11, 12, ĐGNL, THPT QG).',
  {
    type: z.enum(['tam_giac', 'tu_giac', 'chop_deu', 'custom'])
      .describe('Loại chóp: tam_giac (S.ABC), tu_giac (S.ABCD), chop_deu (chóp đều có đáy đều và tâm O)'),
    base_shape: z.enum([
      'tam_giac_vuong_A', 'tam_giac_vuong_B', 'tam_giac_vuong_C',
      'tam_giac_deu', 'tam_giac_can', 'tam_giac_thuong',
      'hinh_vuong', 'hinh_chu_nhat', 'hinh_thoi', 'hinh_binh_hanh', 'hinh_thang_vuong'
    ]).describe('Hình dạng đáy: tam giác vuông tại A/B/C, tam giác đều, tam giác cân, hình vuông, chữ nhật, thoi, bình hành, thang vuông'),
    height_type: z.enum([
      'SA_vuong_goc_day', 'SB_vuong_goc_day', 'SC_vuong_goc_day',
      'chop_deu', 'SO_chop_deu',
      'SH_trung_diem_AB', 'SH_trung_diem_AD', 'SH_trong_tam', 'custom'
    ]).optional().describe('Vị trí đường cao: SA vuông góc đáy, SB vuông góc đáy, SO chóp đều, SH trung điểm AB, SH trọng tâm đáy...'),
    dimensions: z.object({
      a: z.number().optional().describe('Độ dài cạnh a (mặc định 4)'),
      b: z.number().optional().describe('Độ dài cạnh b (mặc định 3 hoặc cạnh thứ hai)'),
      c: z.number().optional().describe('Độ dài cạnh c'),
      h: z.number().optional().describe('Chiều cao h của đỉnh chóp (mặc định 5)')
    }).optional().describe('Kích thước các cạnh và chiều cao khối chóp'),
    labels: z.object({
      apex: z.string().optional().describe("Tên đỉnh chóp (mặc định 'S')"),
      base: z.array(z.string()).optional().describe("Tên các đỉnh đáy (ví dụ ['A', 'B', 'C'] hoặc ['A', 'B', 'C', 'D'])"),
      height_foot: z.string().optional().describe("Tên chân đường cao (mặc định 'H' hoặc 'O')")
    }).optional().describe('Tùy biến tên các điểm đỉnh'),
    draw_height: z.boolean().optional().describe('Tự động vẽ đường cao nối đỉnh và chân đường cao bằng nét đứt (mặc định true)'),
    draw_base_diagonals: z.boolean().optional().describe('Tự động vẽ đường chéo đáy nét đứt nếu là tứ giác (mặc định true)'),
    opacity: z.number().optional().describe('Độ mờ các mặt chóp (0.0 đến 1.0, mặc định 0.25 để nhìn rõ các đường bên trong)'),
    color: z.string().optional().describe("Mã màu hex khối chóp (ví dụ '#2563eb' cho màu xanh)"),
    height_color: z.string().optional().describe("Mã màu hex cho đường cao (mặc định '#dc2626' màu đỏ)"),
    extra_points: z.array(z.object({
      name: z.string().describe("Tên điểm, ví dụ 'M'"),
      midpoint_of: z.array(z.string()).optional().describe("Tên 2 điểm nếu là trung điểm, ví dụ ['S', 'C']"),
      coords: z.array(z.number()).optional().describe('Tọa độ [x, y, z] nếu là điểm tự do'),
      color: z.string().optional().describe('Mã màu hex của điểm')
    })).optional().describe('Các điểm phụ thêm: trung điểm các cạnh, tỉ lệ điểm...'),
    planes: z.array(z.object({
      points: z.array(z.string()).describe("Danh sách tên điểm tạo mặt phẳng, ví dụ ['A', 'M', 'N']"),
      color: z.string().optional().describe('Màu mặt phẳng'),
      opacity: z.number().optional().describe('Độ mờ')
    })).optional().describe('Các mặt phẳng thiết diện bổ sung'),
    clear_before: z.boolean().optional().describe('Xóa các hình vẽ cũ trước khi vẽ hình mới (mặc định true)'),
    show_axes: z.boolean().optional().describe('Hiện hệ trục tọa độ 3D (mặc định false)'),
    show_grid: z.boolean().optional().describe('Hiện lưới tọa độ nền (mặc định false)')
  },
  async (args) => {
    try {
      const result = await requestBridge('/pyramid', 'POST', args);
      const content = [];

      let textSummary = `### Đã dựng hình chóp thành công trên GeoGebra!\n\n`;
      textSummary += `${result.explanation}\n\n`;
      textSummary += `**Tọa độ các điểm chính:**\n`;
      for (const [name, coord] of Object.entries(result.points || {})) {
        textSummary += `- Điểm $${name} = (${coord.join(', ')})$\n`;
      }
      if (result.foot && result.foot.coords) {
        textSummary += `- Chân đường cao $${result.foot.label} = (${result.foot.coords.join(', ')})$\n`;
      }
      textSummary += `\n**Thông số hình học:**\n`;
      textSummary += `- Chiều cao $h = ${result.height}$\n`;
      textSummary += `- Diện tích đáy $S_{đáy} \\approx ${result.baseArea}$\n`;
      textSummary += `- Thể tích khối chóp: $${result.volumeFormula}$\n\n`;
      textSummary += `*Đã tự động chuyển sang chế độ 3D Graphics View trong GeoGebra Desktop. Bạn có thể dùng chuột để xoay hình 360 độ hoặc nhấp chuột phải vào bất kỳ điểm nào để đổi tên nhanh!*`;

      content.push({ type: 'text', text: textSummary });

      if (result.image) {
        content.push({
          type: 'image',
          data: cleanBase64(result.image),
          mimeType: 'image/png'
        });
      }

      return { content };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Lỗi khi vẽ hình chóp: ${err.message}` }],
        isError: true
      };
    }
  }
);

// =========================================================================
// TOOL 2: geogebra_eval (CHẠY CÁC CÂU LỆNH GEOGEBRA TÙY Ý)
// =========================================================================
server.tool(
  'geogebra_eval',
  'Thực thi trực tiếp một danh sách các câu lệnh GeoGebra (ví dụ: A = (0,0,0), S = (0,0,5), Pyramid(A,B,C,S), Segment(A,B), SetColor(A, "red"), v.v.).',
  {
    commands: z.array(z.string()).describe('Danh sách các câu lệnh GeoGebra cần thực thi'),
    clear_before: z.boolean().optional().describe('Có xóa bảng vẽ trước khi thực thi không (mặc định false)')
  },
  async ({ commands, clear_before }) => {
    try {
      if (clear_before) {
        await requestBridge('/reset', 'POST');
      }
      const result = await requestBridge('/eval', 'POST', { commands });
      return {
        content: [{
          type: 'text',
          text: `Đã thực thi thành công ${result.executedCount} lệnh GeoGebra. Tổng số đối tượng trên bảng vẽ hiện tại: ${result.totalObjects}.`
        }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Lỗi khi thực thi lệnh GeoGebra: ${err.message}` }],
        isError: true
      };
    }
  }
);

// =========================================================================
// TOOL 3: geogebra_screenshot (CHỤP ẢNH MÀN HÌNH BẢNG VẼ)
// =========================================================================
server.tool(
  'geogebra_screenshot',
  'Chụp ảnh không gian 3D/2D hiện tại trên GeoGebra và trả về ảnh dạng PNG.',
  {},
  async () => {
    try {
      const result = await requestBridge('/screenshot', 'GET');
      if (!result.image) {
        return {
          content: [{ type: 'text', text: 'Không thể chụp ảnh màn hình GeoGebra.' }],
          isError: true
        };
      }
      return {
        content: [
          { type: 'text', text: 'Ảnh chụp màn hình GeoGebra hiện tại:' },
          {
            type: 'image',
            data: cleanBase64(result.image),
            mimeType: 'image/png'
          }
        ]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Lỗi chụp ảnh GeoGebra: ${err.message}` }],
        isError: true
      };
    }
  }
);

// =========================================================================
// TOOL 4: geogebra_get_objects (LẤY TẤT CẢ CÁC ĐỐI TƯỢNG HÌNH HỌC)
// =========================================================================
server.tool(
  'geogebra_get_objects',
  'Lấy danh sách tất cả các điểm, đoạn thẳng, đa giác, khối đa diện hiện có trên GeoGebra cùng với tọa độ và định nghĩa.',
  {
    type: z.string().optional().describe('Lọc theo loại đối tượng (ví dụ: point, segment, polygon, pyramid...)'),
    limit: z.number().optional().describe('Giới hạn số lượng đối tượng tối đa cần lấy')
  },
  async ({ type, limit }) => {
    try {
      const params = new URLSearchParams();
      if (type) params.append('type', type);
      if (typeof limit === 'number') params.append('limit', String(limit));
      const queryString = params.toString();
      const endpoint = queryString ? `/objects?${queryString}` : '/objects';

      const result = await requestBridge(endpoint, 'GET');
      return {
        content: [{
          type: 'text',
          text: `Danh sách các đối tượng trên GeoGebra (${result.count} đối tượng):\n\`\`\`json\n${JSON.stringify(result.objects, null, 2)}\n\`\`\``
        }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Lỗi khi lấy danh sách đối tượng: ${err.message}` }],
        isError: true
      };
    }
  }
);

// =========================================================================
// TOOL 5: geogebra_clear (XÓA SẠCH BẢNG VẼ)
// =========================================================================
server.tool(
  'geogebra_clear',
  'Xóa toàn bộ các đối tượng trên bảng vẽ GeoGebra để bắt đầu dựng hình mới.',
  {},
  async () => {
    try {
      await requestBridge('/reset', 'POST');
      return {
        content: [{ type: 'text', text: 'Đã xóa sạch bảng vẽ GeoGebra thành công.' }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Lỗi khi xóa bảng vẽ: ${err.message}` }],
        isError: true
      };
    }
  }
);

// =========================================================================
// TOOL 6: geogebra_set_view (CÀI ĐẶT GÓC NHÌN 3D / 2D)
// =========================================================================
server.tool(
  'geogebra_set_view',
  'Cài đặt góc nhìn GeoGebra: chuyển sang chế độ 3D Graphics View ("T") hoặc 2D ("1"), bật tắt trục tọa độ, lưới nền.',
  {
    perspective: z.enum(['3D', '2D']).optional().describe('Chế độ góc nhìn: 3D hoặc 2D'),
    showAxes: z.boolean().optional().describe('Bật/tắt trục tọa độ'),
    showGrid: z.boolean().optional().describe('Bật/tắt lưới tọa độ')
  },
  async ({ perspective, showAxes, showGrid }) => {
    try {
      if (perspective) {
        await requestBridge('/perspective', 'POST', { perspective: perspective === '3D' ? 'T' : '1' });
      }
      const cmds = [];
      if (typeof showAxes === 'boolean') cmds.push(`ShowAxes(${showAxes})`);
      if (typeof showGrid === 'boolean') cmds.push(`ShowGrid(${showGrid})`);
      if (cmds.length > 0) {
        await requestBridge('/eval', 'POST', { commands: cmds });
      }
      return {
        content: [{ type: 'text', text: 'Đã cập nhật chế độ hiển thị GeoGebra thành công.' }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Lỗi cài đặt góc nhìn: ${err.message}` }],
        isError: true
      };
    }
  }
);

// =========================================================================
// TOOL 7: geogebra_save (LƯU TỆP .GGB)
// =========================================================================
server.tool(
  'geogebra_save',
  'Lưu toàn bộ bài dựng hình hiện tại thành tệp GeoGebra (.ggb) vào ổ đĩa.',
  {
    filePath: z.string().describe('Đường dẫn tuyệt đối đến tệp .ggb cần lưu')
  },
  async ({ filePath }) => {
    try {
      const result = await requestBridge('/save', 'POST', { filePath });
      return {
        content: [{
          type: 'text',
          text: `Đã lưu thành công tệp GeoGebra vào: ${result.filePath} (${result.bytes} bytes).`
        }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Lỗi lưu tệp: ${err.message}` }],
        isError: true
      };
    }
  }
);

// =========================================================================
// TOOL 8: geogebra_load (MỞ TỆP .GGB)
// =========================================================================
server.tool(
  'geogebra_load',
  'Mở một tệp GeoGebra (.ggb) đã lưu từ ổ đĩa.',
  {
    filePath: z.string().describe('Đường dẫn tuyệt đối đến tệp .ggb cần mở')
  },
  async ({ filePath }) => {
    try {
      const result = await requestBridge('/load', 'POST', { filePath });
      return {
        content: [{
          type: 'text',
          text: `Đã tải thành công tệp GeoGebra từ: ${result.filePath}.`
        }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Lỗi tải tệp: ${err.message}` }],
        isError: true
      };
    }
  }
);

// =========================================================================
// TOOL 9: geogebra_open_app (MỞ HOẶC FOCUS ỨNG DỤNG DESKTOP)
// =========================================================================
server.tool(
  'geogebra_open_app',
  'Khởi chạy hoặc đưa cửa sổ ứng dụng GeoGebra Desktop lên phía trước màn hình.',
  {},
  async () => {
    try {
      await ensureAppRunning();
      await requestBridge('/focus', 'POST');
      return {
        content: [{ type: 'text', text: 'Cửa sổ GeoGebra Desktop đã sẵn sàng trên màn hình.' }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Lỗi: ${err.message}` }],
        isError: true
      };
    }
  }
);

// Khởi chạy MCP Stdio Transport
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[GeoGebra MCP] Server started over stdio transport.');
}

run().catch((err) => {
  console.error('[GeoGebra MCP] Fatal error:', err);
  process.exit(1);
});
