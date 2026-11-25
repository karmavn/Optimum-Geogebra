/**
 * GeoGebra Bridge Server
 * Runs a lightweight local HTTP server inside Electron to communicate with MCP Server / Agents
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildPyramidCommands } = require('./pyramid-builder');
const {
  generateToken,
  writeBridgeToken,
  removeBridgeToken,
  verifyBearerToken
} = require('./bridge-auth');
const { bringWindowToFront } = require('./window-utils');

const DEFAULT_PORT = 3999;
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB limit to prevent DoS/memory issues

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

class GeoGebraBridge {
  constructor(getMainWindow, options = {}) {
    this.getMainWindow = getMainWindow;
    this.port = options.port !== undefined
      ? options.port
      : (parseInt(process.env.GEOGEBRA_MCP_PORT, 10) || DEFAULT_PORT);
    this.boundPort = null;
    this.maxBodySize = options.maxBodySize || MAX_BODY_SIZE;
    this.token = options.token || process.env.GEOGEBRA_MCP_TOKEN || generateToken();
    this.persistToken = options.persistToken !== false;
    this.appRoot = path.resolve(options.appRoot || path.join(__dirname, '..'));
    this.server = null;
  }

  isValidHostHeader(hostHeader, boundPort) {
    if (typeof hostHeader !== 'string' || !hostHeader) return false;
    const host = hostHeader.trim().toLowerCase();
    if (host === `127.0.0.1:${boundPort}` || host === `localhost:${boundPort}`) {
      return true;
    }
    return boundPort === 80 && (host === '127.0.0.1' || host === 'localhost');
  }

  isValidOrigin(originHeader) {
    if (originHeader === 'app://local') return true;
    try {
      const parsed = new URL(originHeader);
      return parsed.protocol === 'http:' &&
        (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
    } catch (_) {
      return false;
    }
  }

  requireJsonContentType(req) {
    const raw = (req.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
    if (raw !== 'application/json') {
      throw createHttpError(415, 'Unsupported Media Type: Content-Type must be application/json');
    }
  }

  validateGgbPath(rawPath, { checkAppRoot = false } = {}) {
    if (!rawPath || typeof rawPath !== 'string' || !rawPath.trim()) {
      throw createHttpError(400, 'filePath is required and must be a non-empty string');
    }

    const trimmed = rawPath.trim();
    if (/\0/.test(trimmed) || /^\\\\|^\/\//.test(trimmed)) {
      throw createHttpError(400, 'Invalid filePath: UNC/network paths and null bytes are not allowed');
    }

    let resolvedPath = path.resolve(trimmed);
    if (resolvedPath.startsWith('\\\\')) {
      throw createHttpError(400, 'Invalid filePath: network UNC paths are not allowed');
    }

    if (!resolvedPath.toLowerCase().endsWith('.ggb')) {
      resolvedPath += '.ggb';
    }

    if (checkAppRoot) {
      const normResolved = resolvedPath.toLowerCase();
      const normAppRoot = (this.appRoot + path.sep).toLowerCase();
      if (normResolved === this.appRoot.toLowerCase() || normResolved.startsWith(normAppRoot)) {
        throw createHttpError(403, 'Access forbidden: cannot write inside application installation directory');
      }
    }

    const allowedDir = process.env.GEOGEBRA_ALLOWED_DIR;
    if (allowedDir) {
      const resolvedAllowed = path.resolve(allowedDir);
      const normResolved = resolvedPath.toLowerCase();
      const normAllowed = (resolvedAllowed + path.sep).toLowerCase();
      if (normResolved !== resolvedAllowed.toLowerCase() && !normResolved.startsWith(normAllowed)) {
        throw createHttpError(403, 'Access forbidden: filePath outside GEOGEBRA_ALLOWED_DIR');
      }
    }

    return resolvedPath;
  }

  start() {
    return new Promise((resolve, reject) => {
      if (this.persistToken && this.port !== 0) {
        writeBridgeToken(this.port, this.token);
      }

      this.server = http.createServer(async (req, res) => {
        const boundPort = this.boundPort || this.port;

        // 1. Strict Host validation (protect against DNS rebinding)
        if (!this.isValidHostHeader(req.headers.host, boundPort)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access forbidden: invalid host' }));
          return;
        }

        // 2. Strict Origin validation on ALL HTTP methods (protect against browser CSRF)
        const origin = req.headers.origin;
        if (origin !== undefined) {
          if (!this.isValidOrigin(origin)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Access forbidden: untrusted origin' }));
            return;
          }
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // 3. Per-session Bearer token authentication
        if (!verifyBearerToken(req.headers.authorization, this.token)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing bridge token' }));
          return;
        }

        let pathname = '';
        try {
          let url;
          try {
            url = new URL(req.url, `http://127.0.0.1:${boundPort}`);
          } catch (_) {
            throw createHttpError(400, 'Malformed request URL');
          }
          pathname = url.pathname;

          if (req.method === 'GET' && (pathname === '/status' || pathname === '/health')) {
            await this.handleStatus(res);
          } else if (req.method === 'POST' && pathname === '/eval') {
            this.requireJsonContentType(req);
            const body = await this.parseJsonBody(req);
            await this.handleEval(body, res);
          } else if (req.method === 'POST' && pathname === '/pyramid') {
            this.requireJsonContentType(req);
            const body = await this.parseJsonBody(req);
            await this.handlePyramid(body, res);
          } else if (req.method === 'POST' && pathname === '/reset') {
            await this.handleReset(res);
          } else if (req.method === 'POST' && pathname === '/perspective') {
            this.requireJsonContentType(req);
            const body = await this.parseJsonBody(req);
            await this.handlePerspective(body, res);
          } else if (req.method === 'GET' && pathname === '/screenshot') {
            await this.handleScreenshot(res);
          } else if (req.method === 'GET' && pathname === '/objects') {
            await this.handleGetObjects(url, res);
          } else if (req.method === 'POST' && pathname === '/save') {
            this.requireJsonContentType(req);
            const body = await this.parseJsonBody(req);
            await this.handleSave(body, res);
          } else if (req.method === 'POST' && pathname === '/load') {
            this.requireJsonContentType(req);
            const body = await this.parseJsonBody(req);
            await this.handleLoad(body, res);
          } else if (req.method === 'POST' && pathname === '/focus') {
            await this.handleFocus(res);
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found', path: pathname }));
          }
        } catch (err) {
          console.error('Bridge error on', pathname || req.url, err);
          if (!res.headersSent && !res.destroyed) {
            const statusCode = err.statusCode || (err.message && err.message.includes('too large') ? 413 : 500);
            const headers = { 'Content-Type': 'application/json' };
            if (statusCode === 413) {
              headers['Connection'] = 'close';
            }
            res.writeHead(statusCode, headers);
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
        const addr = this.server.address();
        this.boundPort = addr && typeof addr === 'object' ? addr.port : this.port;
        if (this.persistToken && this.port === 0) {
          writeBridgeToken(this.boundPort, this.token);
        }
        console.log(`[GeoGebraBridge] Server listening on http://127.0.0.1:${this.boundPort}`);
        resolve(this.boundPort);
      });
    });
  }

  parseJsonBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let receivedBytes = 0;
      let settled = false;

      req.on('data', (chunk) => {
        if (settled) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buf.length;
        if (receivedBytes > this.maxBodySize) {
          settled = true;
          if (typeof req.pause === 'function') req.pause();
          reject(createHttpError(413, `Request body too large (max ${this.maxBodySize} bytes)`));
          return;
        }
        chunks.push(buf);
      });

      req.on('end', () => {
        if (settled) return;
        settled = true;
        try {
          const raw = Buffer.concat(chunks).toString('utf8').trim();
          if (!raw) {
            resolve({});
            return;
          }
          const parsed = JSON.parse(raw);
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            reject(createHttpError(400, 'Request body must be a JSON object'));
            return;
          }
          resolve(parsed);
        } catch (_) {
          reject(createHttpError(400, 'Invalid JSON in request body'));
        }
      });

      req.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
    });
  }

  async runInRenderer(jsCode) {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) {
      throw createHttpError(503, 'GeoGebra window is not available');
    }
    return await win.webContents.executeJavaScript(jsCode);
  }

  bringToFront() {
    bringWindowToFront(this.getMainWindow());
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
      res.end(JSON.stringify({
        running: true,
        appletReady: status.ready,
        objectCount: status.objectCount,
        windowVisible: win.isVisible(),
        windowMinimized: win.isMinimized()
      }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: true, appletReady: false, error: err.message }));
    }
  }

  async handleEval(body, res) {
    this.bringToFront();
    const commands = body.commands || [];
    const cmdsArray = Array.isArray(commands) ? commands : [commands];
    const result = await this.runInRenderer(`
      (() => {
        if (!window.ggbBridge) throw new Error('GeoGebra bridge is not ready');
        return window.ggbBridge.evalCommands(${JSON.stringify(cmdsArray)});
      })()
    `);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  async handlePyramid(body, res) {
    this.bringToFront();

    // Tạo tập lệnh từ pyramid-builder
    const pyramidData = buildPyramidCommands(body);

    // Chạy nguyên khối trong một lần gọi renderer duy nhất (Atomic Batch) + đồng bộ rAF
    const evalRes = await this.runInRenderer(`
      (async () => {
        if (!window.ggbBridge) throw new Error('GeoGebra bridge is not ready');
        if (typeof window.ggbBridge.renderPyramidBatch === 'function') {
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
    const result = await this.runInRenderer(`
      (() => {
        if (!window.ggbBridge) throw new Error('GeoGebra bridge is not ready');
        return window.ggbBridge.reset();
      })()
    `);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  async handlePerspective(body, res) {
    const p = body.perspective || 'T';
    const result = await this.runInRenderer(`
      (() => {
        if (!window.ggbBridge) throw new Error('GeoGebra bridge is not ready');
        return window.ggbBridge.setPerspective(${JSON.stringify(p)});
      })()
    `);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  async captureScreenshot() {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return null;

    try {
      await this.runInRenderer(`
        (async () => {
          let wasOpen = false;
          if (typeof window.dismissQuickRenamePopup === 'function') {
            wasOpen = Boolean(window.dismissQuickRenamePopup());
          } else {
            const popup = document.querySelector('.quick-rename-popup');
            if (popup && popup.style.display !== 'none') {
              wasOpen = true;
              popup.style.display = 'none';
              popup.classList.remove('is-open');
            }
          }
          if (wasOpen) {
            await new Promise((resolve) => {
              const timer = setTimeout(resolve, 50);
              requestAnimationFrame(() => {
                clearTimeout(timer);
                resolve();
              });
            });
          }
          return wasOpen;
        })()
      `);
    } catch (_) {}

    const currentWin = this.getMainWindow();
    if (!currentWin || currentWin.isDestroyed()) return null;

    // Chụp trực tiếp canvas/viewport từ Chromium GPU surface (Native C++ GPU capture)
    const nativeImage = await currentWin.webContents.capturePage();
    const buffer = nativeImage.toPNG();
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }

  async handleScreenshot(res) {
    const imgData = await this.captureScreenshot();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: !!imgData, image: imgData }));
  }

  async handleGetObjects(url, res) {
    const filterType = url.searchParams.get('type') || null;
    const limitRaw = url.searchParams.get('limit');
    const parsedLimit = limitRaw !== null && limitRaw !== '' ? Number(limitRaw) : null;

    let objects = await this.runInRenderer(`
      (() => {
        if (!window.ggbBridge) throw new Error('GeoGebra bridge is not ready');
        return window.ggbBridge.getObjects();
      })()
    `);
    if (filterType) {
      objects = objects.filter(o => o.type && o.type.toLowerCase() === filterType.toLowerCase());
    }
    if (Number.isInteger(parsedLimit) && parsedLimit >= 0) {
      objects = objects.slice(0, parsedLimit);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: objects.length, objects }));
  }

  async handleSave(body, res) {
    const resolvedPath = this.validateGgbPath(body.filePath, { checkAppRoot: true });

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
    const resolvedPath = this.validateGgbPath(body.filePath, { checkAppRoot: false });

    let stat;
    try {
      stat = await fs.promises.stat(resolvedPath);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        throw createHttpError(400, 'File not found: ' + resolvedPath);
      }
      throw err;
    }

    if (!stat.isFile()) {
      throw createHttpError(400, 'Path is not a file: ' + resolvedPath);
    }
    if (stat.size > this.maxBodySize) {
      throw createHttpError(413, `File too large (max ${this.maxBodySize} bytes)`);
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

    this.bringToFront();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, filePath: resolvedPath }));
  }

  async handleFocus(res) {
    this.bringToFront();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  }

  stop() {
    if (this.persistToken && (this.boundPort || this.port)) {
      removeBridgeToken(this.boundPort || this.port, this.token);
    }
    if (this.server) {
      this.server.close();
      if (typeof this.server.closeAllConnections === 'function') {
        this.server.closeAllConnections();
      }
      this.server = null;
    }
  }
}

module.exports = GeoGebraBridge;
