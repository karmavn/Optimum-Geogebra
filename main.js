const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, session } = require('electron');
const path = require('path');
const fs = require('fs');
const GeoGebraBridge = require('./src/geogebra-bridge');

const APP_ROOT = path.resolve(__dirname);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.ggb': 'application/vnd.geogebra.file',
  '.txt': 'text/plain; charset=utf-8'
};

// Enable V8 bytecode code caching and standard web APIs for local app:// origin
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true
    }
  }
]);

let mainWindow = null;

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    try {
      const reqUrl = new URL(request.url);
      let relPath = decodeURIComponent(reqUrl.pathname).replace(/^\/+/, '');
      if (!relPath) relPath = 'index.html';

      const resolved = path.resolve(APP_ROOT, relPath);
      if (resolved !== APP_ROOT && !resolved.startsWith(APP_ROOT + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }

      const [stat, data] = await Promise.all([
        fs.promises.stat(resolved),
        fs.promises.readFile(resolved)
      ]);
      const ext = path.extname(resolved).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const isHtml = ext === '.html';

      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(data.byteLength),
          'Last-Modified': stat.mtime.toUTCString(),
          'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable'
        }
      });
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'EISDIR')) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response('Internal Server Error', { status: 500 });
    }
  });
}

function buildAppMenu() {
  const menuTemplate = [
    {
      label: 'Tệp',
      submenu: [
        {
          label: 'Mở tệp .ggb...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            try {
              const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
                title: 'Mở tệp GeoGebra',
                filters: [{ name: 'GeoGebra File', extensions: ['ggb'] }],
                properties: ['openFile']
              });
              if (!canceled && filePaths.length > 0 && !mainWindow.isDestroyed()) {
                const fileData = await fs.promises.readFile(filePaths[0]);
                mainWindow.webContents.send('load-ggb-file', fileData.toString('base64'));
              }
            } catch (err) {
              console.error('Failed to open .ggb file:', err);
            }
          }
        },
        {
          label: 'Lưu tệp .ggb...',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('request-save-ggb');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Thoát',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Xem',
      submenu: [
        { role: 'reload', label: 'Tải lại' },
        { role: 'forceReload', label: 'Tải lại cưỡng bức' },
        { role: 'toggleDevTools', label: 'Công cụ phát triển (DevTools)' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Thu phóng mặc định' },
        { role: 'zoomIn', label: 'Phóng to' },
        { role: 'zoomOut', label: 'Thu nhỏ' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toàn màn hình' }
      ]
    },
    {
      label: 'Trợ giúp',
      submenu: [
        {
          label: 'Về tính năng Đổi tên nhanh',
          click: () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'GeoGebra Quick Rename',
              message: 'Tính năng Đổi tên nhanh cho GeoGebra (Offline)',
              detail: 'Ứng dụng chạy hoàn toàn offline không cần Internet.\n\nNhấp chuột phải trực tiếp vào bất kỳ điểm nào trên bảng vẽ để mở ngay ô đổi tên tức thì. Nhấn Enter để xác nhận, Escape để hủy.'
            });
          }
        }
      ]
    }
  ];

  return Menu.buildFromTemplate(menuTemplate);
}

function bringWindowToFront(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true);
  win.focus();
  win.setAlwaysOnTop(false);
}

function createWindow() {
  const iconPath = path.join(APP_ROOT, 'icon.png');
  const windowOptions = {
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: true, // Luôn hiển thị ngay để người dùng nhìn thấy cửa sổ GeoGebra trên màn hình
    backgroundColor: '#f8fafc',
    title: 'GeoGebra Custom - Quick Rename (Offline Edition)',
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false, // Performance: Tắt kiểm tra chính tả ngầm để tiết kiệm RAM & CPU
      backgroundThrottling: false, // Giữ hiệu năng mượt khi chuyển tab
      v8CacheOptions: 'bypassHeatCheck' // Cache V8 bytecode ngay từ lần chạy đầu
    }
  };

  if (fs.existsSync(iconPath)) {
    windowOptions.icon = iconPath;
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Đảm bảo đưa cửa sổ lên phía trước khi sẵn sàng
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      bringWindowToFront(mainWindow);
    }
  });

  // Dự phòng an toàn: Đảm bảo cửa sổ luôn được hiển thị và focus
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      bringWindowToFront(mainWindow);
    }
  }, 1000);

  mainWindow.loadURL('app://local/index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC: Lưu file GGB bất đồng bộ (Non-blocking I/O)
ipcMain.handle('save-ggb-dialog', async (_event, base64Data) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false };
  }
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Lưu tệp GeoGebra',
      defaultPath: 'hinh-hoc.ggb',
      filters: [{ name: 'GeoGebra File', extensions: ['ggb'] }]
    });

    if (!canceled && filePath) {
      const buffer = Buffer.from(base64Data, 'base64');
      await fs.promises.writeFile(filePath, buffer);
      return { success: true, filePath };
    }
    return { success: false };
  } catch (err) {
    console.error('Failed to save .ggb file:', err);
    return { success: false, error: err.message };
  }
});

let bridge = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  session.defaultSession.setCodeCachePath(path.join(app.getPath('userData'), 'Code Cache'));
  registerAppProtocol();
  // Set application menu before creating BrowserWindow so initial viewport dimensions are accurate
  Menu.setApplicationMenu(buildAppMenu());
  createWindow();

  // Khởi động HTTP Bridge cho MCP Server / Agent
  bridge = new GeoGebraBridge(() => mainWindow);
  try {
    await bridge.start();
  } catch (err) {
    console.warn('[GeoGebraBridge] Không thể khởi động bridge server:', err.message);
  }
});

app.on('window-all-closed', () => {
  if (bridge) bridge.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (bridge) bridge.stop();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
