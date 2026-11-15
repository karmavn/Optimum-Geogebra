/**
 * GeoGebra Bridge Server
 * Runs a lightweight local HTTP server inside Electron to communicate with MCP Server / Agents
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildPyramidCommands } = require('./pyramid-builder');

const DEFAULT_PORT = 3999;
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB limit to prevent DoS/memory issues

class GeoGebraBridge {
  constructor(getMainWindow) {
    this.getMainWindow = getMainWindow;
    this.port = parseInt(process.env.GEOGEBRA_MCP_PORT, 10) || DEFAULT_PORT;
    this.server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Host validation (Bảo vệ chống tấn công DNS Rebinding)
        const host = req.headers.host || '';
        if (!host.startsWith('127.0.0.1') && !host.startsWith('localhost')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access forbidden: invalid host' }));
          return;
        }

        // Kiểm tra và bảo vệ CORS (Chỉ cho phép nguồn cục bộ, chặn hoàn toàn CSRF từ các website bên ngoài)
        const origin = req.headers.origin;
        const isLocalOrigin = origin && (
          origin.startsWith('http://127.0.0.1') ||
          origin.startsWith('http://localhost') ||
          origin.startsWith('app://')
        );

        if (isLocalOrigin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(isLocalOrigin || !origin ? 204 : 403);
          res.end();
          return;
        }

        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = url.pathname;

        try {
          if (req.method === 'GET' && (pathname === '/status' || pathname === '/health')) {
            await this.handleStatus(res);
          } else if (req.method === 'POST' && pathname === '/eval') {
            const body = await this.parseJsonBody(req);
            await this.handleEval(body, res);
          } else if (req.method === 'POST' && pathname === '/pyramid') {
            const body = await this.parseJsonBody(req);
            await this.handlePyramid(body, res);
          } else if (req.method === 'POST' && pathname === '/reset') {
            await this.handleReset(res);
          } else if (req.method === 'POST' && pathname === '/perspective') {
            const body = await this.parseJsonBody(req);
            await this.handlePerspective(body, res);
          } else if (req.method === 'GET' && pathname === '/screenshot') {
            await this.handleScreenshot(res);
          } else if (req.method === 'GET' && pathname === '/objects') {
            await this.handleGetObjects(req, res);
          } else if (req.method === 'POST' && pathname === '/save') {
            const body = await this.parseJsonBody(req);
            await this.handleSave(body, res);
          } else if (req.method === 'POST' && pathname === '/load') {
            const body = await this.parseJsonBody(req);
            await this.handleLoad(body, res);
          } else if (req.method === 'POST' && pathname === '/focus') {
            await this.handleFocus(res);
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found', path: pathname }));
          }
        } catch (err) {
          console.error('Bridge error on', pathname, err);
          if (!res.headersSent && !res.destroyed) {
            const statusCode = err.statusCode || (err.message && err.message.includes('too large') ? 413 : 500);
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || String(err) }));
          }
        }
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[GeoGebraBridge] Port ${this.port} is already in use (possibly another instance).`);
        }
        reject(err);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[GeoGebraBridge] Server listening on http://127.0.0.1:${this.port}`);
        resolve(this.port);
      });
    });
  }

  parseJsonBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      let receivedBytes = 0;

      req.on('data', chunk => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_BODY_SIZE) {
          req.destroy();
          const err = new Error(`Request body too large (max ${MAX_BODY_SIZE / (1024 * 1024)}MB)`);
          err.statusCode = 413;
          reject(err);
          return;
        }
        data += chunk;
      });

      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (err) {
          const parseErr = new Error('Invalid JSON in request body');
          parseErr.statusCode = 400;
          reject(parseErr);
        }
      });

      req.on('error', reject);
    });
  }

  async runInRenderer(jsCode) {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) {
      throw new Error('GeoGebra window is not available');
    }
    return await win.webContents.executeJavaScript(jsCode);
  }

  async handleStatus(res) {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: false, appletReady: false }));
      return;
    }

    try {
      const status = await this.runInRenderer(`
        (() => {
          const ready = window.ggbBridge ? window.ggbBridge.isReady() : false;
          let count = 0;
          if (ready && window.ggbApiInstance && window.ggbApiInstance.getAllObjectNames) {
            count = window.ggbApiInstance.getAllObjectNames().length;
          }
          return { ready, objectCount: count };
        })()
      `);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: true, appletReady: status.ready, objectCount: status.objectCount }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: true, appletReady: false, error: err.message }));
    }
  }

  async handleEval(body, res) {
    const commands = body.commands || [];
    const cmdsArray = Array.isArray(commands) ? commands : [commands];
    const js = `window.ggbBridge.evalCommands(${JSON.stringify(cmdsArray)})`;
    const result = await this.runInRenderer(js);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  async handlePyramid(body, res) {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
    }

    // Tạo tập lệnh từ pyramid-builder
    const pyramidData = buildPyramidCommands(body);

    // Tối ưu hóa hiệu năng: Chạy nguyên khối trong một lần gọi renderer duy nhất (Atomic Batch)
    // kết hợp đồng bộ hóa 2 frame rAF thay vì 4 lần IPC tuần tự và 400ms sleep
    const evalRes = await this.runInRenderer(`
      (async () => {
        if (window.ggbBridge && typeof window.ggbBridge.renderPyramidBatch === 'function') {
          return await window.ggbBridge.renderPyramidBatch({
            commands: ${JSON.stringify(pyramidData.commands)},
            perspective: "T",
            clearBefore: ${body.clear_before !== false}
          });
        } else {
          if (${body.clear_before !== false}) window.ggbBridge.reset();
          window.ggbBridge.setPerspective("T");
          return window.ggbBridge.evalCommands(${JSON.stringify(pyramidData.commands)});
        }
      })()
    `);

    // Lấy ảnh chụp màn hình ngay khi frame vừa được render
    let screenshotBase64 = null;
    try {
      screenshotBase64 = await this.captureScreenshot();
    } catch (err) {
      console.warn('Screenshot capture failed:', err);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      explanation: pyramidData.explanation,
      points: pyramidData.points,
      foot: pyramidData.foot,
      baseArea: pyramidData.baseArea,
      height: pyramidData.height,
      volume: pyramidData.volume,
      volumeFormula: pyramidData.volumeFormula,
      commands: pyramidData.commands,
      evalResult: evalRes,
      image: screenshotBase64
    }));
  }

  async handleReset(res) {
    const result = await this.runInRenderer(`window.ggbBridge.reset()`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  async handlePerspective(body, res) {
    const p = body.perspective || 'T';
    const result = await this.runInRenderer(`window.ggbBridge.setPerspective(${JSON.stringify(p)})`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  async captureScreenshot() {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return null;

    // Chụp trực tiếp canvas/viewport từ Chromium GPU surface (Native C++ GPU capture, < 20ms)
    // Tránh độ trễ lớn khi GWT biên dịch lại 3D canvas sang PNG trong JavaScript
    const nativeImage = await win.webContents.capturePage();
    const buffer = nativeImage.toPNG();
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }

  async handleScreenshot(res) {
    const imgData = await this.captureScreenshot();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: !!imgData, image: imgData }));
  }

  async handleGetObjects(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const filterType = url.searchParams.get('type') || null;
    const limit = parseInt(url.searchParams.get('limit'), 10) || null;

    let objects = await this.runInRenderer(`window.ggbBridge.getObjects()`);
    if (filterType) {
      objects = objects.filter(o => o.type && o.type.toLowerCase() === filterType.toLowerCase());
    }
    if (limit && limit > 0) {
      objects = objects.slice(0, limit);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: objects.length, objects }));
  }

  async handleSave(body, res) {
    const rawPath = body.filePath;
    if (!rawPath || typeof rawPath !== 'string' || !rawPath.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'filePath is required and must be a non-empty string' }));
      return;
    }

    let resolvedPath = path.resolve(rawPath.trim());
    if (!resolvedPath.toLowerCase().endsWith('.ggb')) {
      resolvedPath += '.ggb';
    }

    const base64Data = await this.runInRenderer(`
      new Promise((resolve, reject) => {
        if (!window.ggbApiInstance) return reject(new Error('Applet not ready'));
        let done = false;
        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            reject(new Error('GeoGebra getBase64 timed out after 10s'));
          }
        }, 10000);

        try {
          window.ggbApiInstance.getBase64((data) => {
            if (!done) {
              done = true;
              clearTimeout(timer);
              if (data) resolve(data);
              else reject(new Error('GeoGebra getBase64 returned empty data'));
            }
          });
        } catch (err) {
          if (!done) {
            done = true;
            clearTimeout(timer);
            reject(err);
          }
        }
      })
    `);

    const buffer = Buffer.from(base64Data, 'base64');
    await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.promises.writeFile(resolvedPath, buffer);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, filePath: resolvedPath, bytes: buffer.length }));
  }

  async handleLoad(body, res) {
    const rawPath = body.filePath;
    if (!rawPath || typeof rawPath !== 'string' || !rawPath.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'filePath is required and must be a non-empty string' }));
      return;
    }

    let resolvedPath = path.resolve(rawPath.trim());
    if (!resolvedPath.toLowerCase().endsWith('.ggb')) {
      resolvedPath += '.ggb';
    }
    if (!fs.existsSync(resolvedPath)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found: ' + resolvedPath }));
      return;
    }

    const fileBuffer = await fs.promises.readFile(resolvedPath);
    const base64 = fileBuffer.toString('base64');
    await this.runInRenderer(`
      (() => {
        if (!window.ggbApiInstance) throw new Error('Applet not ready');
        window.ggbApiInstance.setBase64(${JSON.stringify(base64)});
        return true;
      })()
    `);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, filePath: resolvedPath }));
  }

  async handleFocus(res) {
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

module.exports = GeoGebraBridge;
