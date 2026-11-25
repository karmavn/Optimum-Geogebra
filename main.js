const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const GeoGebraBridge = require('./src/geogebra-bridge');
const { bringWindowToFront } = require('./src/window-utils');

const MAX_CRASH_LOG_BYTES = 1024 * 1024;
const MAX_SAVE_BASE64_LEN = 20 * 1024 * 1024;

function logFatalError(tag, err) {
  const detail = (err && err.stack) || String(err);
  console.error(`[${tag}]`, detail);
  try {
    const baseDir = app.isReady() ? app.getPath('userData') : os.tmpdir();
    const logPath = path.join(baseDir, 'crash.log');
    fs.promises.stat(logPath)
      .then((stat) => (stat.size < MAX_CRASH_LOG_BYTES ? fs.promises.appendFile(logPath, `[${new Date().toISOString()}] [${tag}] ${detail}\n`) : null))
      .catch((statErr) => {
        if (statErr && statErr.code === 'ENOENT') {
          return fs.promises.mkdir(baseDir, { recursive: true })
            .then(() => fs.promises.appendFile(logPath, `[${new Date().toISOString()}] [${tag}] ${detail}\n`));
        }
        return null;
      })
      .catch(() => {});
  } catch (_) {}
}

process.on('uncaughtException', (err) => {
  logFatalError('uncaughtException', err);
});

process.on('unhandledRejection', (reason) => {
  logFatalError('unhandledRejection', reason);
});

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

function isAllowedAppAsset(normalizedRel) {
  return (
    normalizedRel === 'index.html' ||
    normalizedRel === 'styles.css' ||
    normalizedRel === 'src/quick-rename.js' ||
    normalizedRel.startsWith('geogebra-offline/')
  );
}

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

      const normalizedRel = path.relative(APP_ROOT, resolved).split(path.sep).join('/');
      if (!isAllowedAppAsset(normalizedRel)) {
        return new Response('Forbidden', { status: 403 });
      }

      const [stat, data] = await Promise.all([
        fs.promises.stat(resolved),
        fs.promises.readFile(resolved)
      ]);
      const ext = path.extname(resolved).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const isImmutableVendor = normalizedRel.startsWith('geogebra-offline/');

      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(data.byteLength),
          'Last-Modified': stat.mtime.toUTCString(),
          'Cache-Control': isImmutableVendor ? 'public, max-age=31536000, immutable' : 'no-cache'
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

function createWindow() {
  const iconPath = path.join(APP_ROOT, 'icon.png');
  const windowOptions = {
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: true,
    backgroundColor: '#f8fafc',
    title: 'GeoGebra Custom - Quick Rename (Offline Edition)',
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
      v8CacheOptions: 'bypassHeatCheck'
    }
  };

  if (fs.existsSync(iconPath)) {
    windowOptions.icon = iconPath;
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Enforce strict offline & same-origin navigation boundaries
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, navUrl) => {
    if (!navUrl.startsWith('app://local/')) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    logFatalError('webContents:did-fail-load', `${errorCode} ${errorDescription} on ${validatedURL}`);
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      bringWindowToFront(mainWindow);
    }
  });

  mainWindow.loadURL('app://local/index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC: Lưu file GGB bất đồng bộ (Non-blocking I/O)
ipcMain.handle('save-ggb-dialog', async (event, base64Data) => {
  const senderUrl = event && event.senderFrame && event.senderFrame.url;
  if (!senderUrl || !senderUrl.startsWith('app://local/')) {
    return { success: false, error: 'Unauthorized IPC sender' };
  }
  if (typeof base64Data !== 'string' || base64Data.length === 0 || base64Data.length > MAX_SAVE_BASE64_LEN) {
    return { success: false, error: 'Invalid GGB data payload' };
  }
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
    bringWindowToFront(mainWindow);
  });

  app.whenReady().then(async () => {
    session.defaultSession.setCodeCachePath(path.join(app.getPath('userData'), 'Code Cache'));

    // Enforce 100% offline: block any outbound http/https/ws requests from renderer
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = /^(app|data|blob|devtools):/i.test(details.url);
      callback({ cancel: !allowed });
    });

    registerAppProtocol();
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
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (bridge) {
    bridge.stop();
    bridge = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
