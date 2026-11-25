#!/usr/bin/env node
/**
 * GeoGebra 3D MCP Server
 * Connects AI agents to the GeoGebra Desktop application to draw 3D geometry (hình chóp, lăng trụ, v.v.)
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const path = require('path');
const { spawn } = require('child_process');
const { readBridgeToken } = require('./src/bridge-auth');
const { roundNum } = require('./src/pyramid-builder');

const PORT = parseInt(process.env.GEOGEBRA_MCP_PORT, 10) || 3999;
const BRIDGE_URL = `http://127.0.0.1:${PORT}`;
const APP_DIR = path.resolve(__dirname);

function buildAuthHeaders(extra = {}) {
  const headers = { ...extra };
  const token = readBridgeToken(PORT);
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function isBridgeReady(timeout = 2500) {
  try {
    const res = await fetch(`${BRIDGE_URL}/status`, {
      headers: buildAuthHeaders(),
      signal: AbortSignal.timeout(timeout)
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!(data.running && data.appletReady);
  } catch (_) {
    return false;
  }
}

function buildWindowsTaskScript(batPath, port) {
  const escapedBat = String(batPath).replace(/'/g, "''");
  const escapedPort = String(port).replace(/'/g, "''");
  return [
    `$bat = '${escapedBat}'`,
    `$portArg = '${escapedPort}'`,
    `$action = New-ScheduledTaskAction -Execute $bat -Argument $portArg`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
    `Register-ScheduledTask -TaskName 'LaunchGeoGebraOnDesktop' -Action $action -Settings $settings -Force | Out-Null`,
    `Start-ScheduledTask -TaskName 'LaunchGeoGebraOnDesktop'`
  ].join('; ');
}

function spawnDirectElectron() {
  const runScript = path.join(APP_DIR, 'run-electron.js');
  const env = { ...process.env, GEOGEBRA_MCP_PORT: String(PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.execPath, [runScript], {
    cwd: APP_DIR,
    env,
    detached: true,
    stdio: 'ignore'
  });
  child.on('error', (err) => {
    console.error('[GeoGebra MCP] Direct Electron launch failed:', err.message);
  });
  child.unref();
}

function launchDesktopProcess() {
  if (process.platform !== 'win32') {
    spawnDirectElectron();
    return;
  }

  const batPath = path.join(APP_DIR, 'start-geogebra.bat');
  const psScript = buildWindowsTaskScript(batPath, PORT);
  let fallbackTriggered = false;
  const triggerFallback = () => {
    if (fallbackTriggered) return;
    fallbackTriggered = true;
    spawnDirectElectron();
  };

  try {
    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    ps.on('error', triggerFallback);
    ps.on('exit', (code) => {
      if (code !== 0) {
        triggerFallback();
      }
    });
    ps.unref();
  } catch (_) {
    triggerFallback();
  }
}

function createSingleFlightLauncher(fn) {
  let inFlight = null;
  return (...args) => {
    if (!inFlight) {
      let p;
      try {
        p = Promise.resolve(fn(...args));
      } catch (err) {
        p = Promise.reject(err);
      }
      inFlight = p.finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}

const ensureAppRunning = createSingleFlightLauncher(async (timeoutMs = 25000) => {
  if (await isBridgeReady(1200)) return true;

  launchDesktopProcess();

  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, 600));
    if (await isBridgeReady(1000)) {
      return true;
    }
  }

  throw new Error('Ứng dụng GeoGebra đang khởi động quá thời gian chờ (25 giây). Vui lòng thử lại lệnh.');
});

async function requestBridge(endpoint, method = 'GET', body = null) {
  await ensureAppRunning();

  const send = () => {
    const options = {
      method,
      headers: buildAuthHeaders({
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
      }),
      signal: AbortSignal.timeout(30000)
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    return fetch(`${BRIDGE_URL}${endpoint}`, options);
  };

  let res = await send();
  if (res.status === 401) {
    // Re-read token in case Electron restarted and rotated its session token
    res = await send();
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GeoGebra Bridge Error (${res.status}): ${errText}`);
  }
  return await res.json();
}

function cleanBase64(base64Str) {
  if (!base64Str || typeof base64Str !== 'string') return '';
  return base64Str.replace(/^data:image\/[a-z]+;base64,/, '');
}

const DRAW_PYRAMID_SCHEMA = {
  type: z.enum(['tam_giac', 'tu_giac', 'chop_deu'])
    .describe('Loại chóp: tam_giac (S.ABC), tu_giac (S.ABCD), chop_deu (chóp đều có đáy đều và tâm O)'),
  base_shape: z.enum([
    'tam_giac_vuong_A', 'tam_giac_vuong_B', 'tam_giac_vuong_C',
    'tam_giac_deu', 'tam_giac_can', 'tam_giac_thuong',
    'hinh_vuong', 'hinh_chu_nhat', 'hinh_thoi', 'hinh_binh_hanh', 'hinh_thang_vuong'
  ]).optional().describe('Hình dạng đáy: tam giác vuông tại A/B/C, tam giác đều, tam giác cân, hình vuông, chữ nhật, thoi, bình hành, thang vuông'),
  height_type: z.enum([
    'SA_vuong_goc_day', 'SB_vuong_goc_day', 'SC_vuong_goc_day',
    'chop_deu', 'SO_chop_deu',
    'SH_trung_diem_AB', 'SH_trung_diem_AD', 'SH_trong_tam'
  ]).optional().describe('Vị trí đường cao: SA/SB/SC vuông góc đáy, SO chóp đều, SH trung điểm AB/AD, SH trọng tâm đáy'),
  dimensions: z.object({
    a: z.number().positive().finite().optional().describe('Độ dài cạnh a (mặc định 4)'),
    b: z.number().positive().finite().optional().describe('Độ dài cạnh b (mặc định 3 hoặc cạnh thứ hai)'),
    c: z.number().positive().finite().optional().describe('Độ dài cạnh c'),
    h: z.number().positive().finite().optional().describe('Chiều cao h của đỉnh chóp (mặc định 5)')
  }).optional().describe('Kích thước các cạnh và chiều cao khối chóp'),
  labels: z.object({
    apex: z.string().optional().describe("Tên đỉnh chóp (mặc định 'S')"),
    base: z.array(z.string()).optional().describe("Tên các đỉnh đáy (ví dụ ['A', 'B', 'C'] hoặc ['A', 'B', 'C', 'D'])"),
    height_foot: z.string().optional().describe("Tên chân đường cao (mặc định 'H', 'O' hoặc 'G')")
  }).optional().describe('Tùy biến tên các điểm đỉnh'),
  draw_height: z.boolean().optional().describe('Tự động vẽ đường cao nối đỉnh và chân đường cao bằng nét đứt (mặc định true)'),
  draw_base_diagonals: z.boolean().optional().describe('Tự động vẽ đường chéo đáy nét đứt nếu là tứ giác (mặc định true)'),
  opacity: z.number().min(0).max(1).optional().describe('Độ mờ các mặt chóp (0.0 đến 1.0, mặc định 0.25 để nhìn rõ các đường bên trong)'),
  color: z.string().optional().describe("Mã màu hex khối chóp (ví dụ '#2563eb' cho màu xanh)"),
  height_color: z.string().optional().describe("Mã màu hex cho đường cao (mặc định '#dc2626' màu đỏ)"),
  extra_points: z.array(z.object({
    name: z.string().describe("Tên điểm, ví dụ 'M'"),
    midpoint_of: z.array(z.string()).length(2).optional().describe("Tên 2 điểm nếu là trung điểm, ví dụ ['S', 'C']"),
    coords: z.array(z.number().finite()).length(3).optional().describe('Tọa độ [x, y, z] nếu là điểm tự do'),
    color: z.string().optional().describe('Mã màu hex của điểm')
  })).optional().describe('Các điểm phụ thêm: trung điểm các cạnh, tọa độ điểm...'),
  planes: z.array(z.object({
    points: z.array(z.string()).min(3).describe("Danh sách tên điểm tạo mặt phẳng, ví dụ ['A', 'M', 'N']"),
    color: z.string().optional().describe('Màu mặt phẳng'),
    opacity: z.number().min(0).max(1).optional().describe('Độ mờ (0.0 đến 1.0)')
  })).optional().describe('Các mặt phẳng thiết diện bổ sung'),
  clear_before: z.boolean().optional().describe('Xóa các hình vẽ cũ trước khi vẽ hình mới (mặc định true)'),
  show_axes: z.boolean().optional().describe('Hiện hệ trục tọa độ 3D (mặc định false)'),
  show_grid: z.boolean().optional().describe('Hiện lưới tọa độ nền (mặc định false)')
};

function createMcpServer() {
  const server = new McpServer({
    name: 'geogebra-3d-server',
    version: '1.0.0'
  });

  // TOOL 1: draw_pyramid
  server.tool(
    'draw_pyramid',
    'Vẽ hình chóp không gian 3D trong GeoGebra (hình chóp tam giác S.ABC, tứ giác S.ABCD, chóp đều, SA/SB/SC vuông góc đáy, SH trung điểm, v.v.) chuẩn theo chương trình Toán THPT Việt Nam (Toán 11, 12, ĐGNL, THPT QG).',
    DRAW_PYRAMID_SCHEMA,
    async (args) => {
      try {
        const result = await requestBridge('/pyramid', 'POST', args);
        const content = [];

        let textSummary = `### Đã dựng hình chóp thành công trên GeoGebra!\n\n`;
        textSummary += `${result.explanation}\n\n`;
        textSummary += `**Tọa độ các điểm chính:**\n`;
        for (const [name, coord] of Object.entries(result.points || {})) {
          const formatted = Array.isArray(coord) ? coord.map(roundNum).join(', ') : coord;
          textSummary += `- Điểm $${name} = (${formatted})$\n`;
        }
        if (result.foot && result.foot.coords) {
          const formattedFoot = result.foot.coords.map(roundNum).join(', ');
          textSummary += `- Chân đường cao $${result.foot.label} = (${formattedFoot})$\n`;
        }
        textSummary += `\n**Thông số hình học:**\n`;
        textSummary += `- Chiều cao $h = ${result.height}$\n`;
        textSummary += `- Diện tích đáy $S_{đáy} \\approx ${result.baseArea}$\n`;
        textSummary += `- Thể tích khối chóp: $${result.volumeFormula}$\n\n`;

        const failedCmds = (result.evalResult && result.evalResult.failedCommands) || [];
        if (failedCmds.length > 0) {
          textSummary += `**Cảnh báo lệnh GeoGebra lỗi (${failedCmds.length}):**\n`;
          for (const f of failedCmds) {
            textSummary += `- \`${f.command}\`: ${f.error}\n`;
          }
          textSummary += `\n`;
        }

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

  // TOOL 2: geogebra_eval
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
        const failedCmds = result.failedCommands || [];
        const failedCount = result.failedCount || failedCmds.length;

        let msg = `Đã thực thi ${result.executedCount} lệnh GeoGebra. Tổng số đối tượng trên bảng vẽ hiện tại: ${result.totalObjects}.`;
        if (failedCount > 0) {
          const detail = failedCmds.map(f => `- \`${f.command}\`: ${f.error}`).join('\n');
          msg += `\n\n**Có ${failedCount} lệnh lỗi:**\n${detail}`;
        }

        return {
          content: [{ type: 'text', text: msg }],
          isError: result.executedCount === 0 && failedCount > 0
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Lỗi khi thực thi lệnh GeoGebra: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // TOOL 3: geogebra_screenshot
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

  // TOOL 4: geogebra_get_objects
  server.tool(
    'geogebra_get_objects',
    'Lấy danh sách tất cả các điểm, đoạn thẳng, đa giác, khối đa diện hiện có trên GeoGebra cùng với tọa độ và định nghĩa.',
    {
      type: z.string().optional().describe('Lọc theo loại đối tượng (ví dụ: point, segment, polygon, pyramid...)'),
      limit: z.number().int().nonnegative().optional().describe('Giới hạn số lượng đối tượng tối đa cần lấy')
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

  // TOOL 5: geogebra_clear
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

  // TOOL 6: geogebra_set_view
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

  // TOOL 7: geogebra_save
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

  // TOOL 8: geogebra_load
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

  // TOOL 9: geogebra_open_app
  server.tool(
    'geogebra_open_app',
    'Khởi chạy hoặc đưa cửa sổ ứng dụng GeoGebra Desktop lên phía trước màn hình.',
    {},
    async () => {
      try {
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

  return server;
}

async function run() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[GeoGebra MCP] Server started over stdio transport.');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[GeoGebra MCP] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = {
  cleanBase64,
  DRAW_PYRAMID_SCHEMA,
  buildWindowsTaskScript,
  createSingleFlightLauncher,
  createMcpServer
};
