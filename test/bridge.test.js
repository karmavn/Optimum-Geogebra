const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const GeoGebraBridge = require('../src/geogebra-bridge.js');

function rawHttpRequest({ port, method = 'GET', path: reqPath = '/status', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers,
      agent: false
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== null) {
      req.write(body);
    }
    req.end();
  });
}

describe('GeoGebra Bridge Unit Tests', () => {
  it('should parse valid JSON body', async () => {
    const bridge = new GeoGebraBridge(() => null, { persistToken: false });
    const mockReq = new EventEmitter();
    process.nextTick(() => {
      mockReq.emit('data', Buffer.from(JSON.stringify({ test: 'ok' })));
      mockReq.emit('end');
    });

    const parsed = await bridge.parseJsonBody(mockReq);
    assert.deepEqual(parsed, { test: 'ok' });
  });

  it('should decode multi-byte UTF-8 Vietnamese characters split across chunks', async () => {
    const bridge = new GeoGebraBridge(() => null, { persistToken: false });
    const payload = Buffer.from(JSON.stringify({ label: 'Hình chóp S.ABC' }), 'utf8');
    // Split right inside a multi-byte UTF-8 sequence (e.g. 'ì' or 'ó')
    const splitIdx = payload.indexOf(0xc3) + 1;
    const chunk1 = payload.subarray(0, splitIdx);
    const chunk2 = payload.subarray(splitIdx);

    const mockReq = new EventEmitter();
    process.nextTick(() => {
      mockReq.emit('data', chunk1);
      mockReq.emit('data', chunk2);
      mockReq.emit('end');
    });

    const parsed = await bridge.parseJsonBody(mockReq);
    assert.equal(parsed.label, 'Hình chóp S.ABC');
  });

  it('should reject invalid JSON body with 400 status', async () => {
    const bridge = new GeoGebraBridge(() => null, { persistToken: false });
    const mockReq = new EventEmitter();
    process.nextTick(() => {
      mockReq.emit('data', Buffer.from('invalid-json{'));
      mockReq.emit('end');
    });

    await assert.rejects(
      () => bridge.parseJsonBody(mockReq),
      (err) => err.statusCode === 400 && err.message.includes('Invalid JSON')
    );
  });

  it('should reject JSON null or primitive bodies with 400 status', async () => {
    const bridge = new GeoGebraBridge(() => null, { persistToken: false });
    const mockReq = new EventEmitter();
    process.nextTick(() => {
      mockReq.emit('data', Buffer.from('null'));
      mockReq.emit('end');
    });

    await assert.rejects(
      () => bridge.parseJsonBody(mockReq),
      (err) => err.statusCode === 400
    );
  });

  it('should pause stream and reject bodies exceeding maxBodySize with 413 status', async () => {
    const bridge = new GeoGebraBridge(() => null, { persistToken: false, maxBodySize: 1024 });
    let paused = false;
    let destroyed = false;
    const mockReq = new EventEmitter();
    mockReq.pause = () => { paused = true; };
    mockReq.destroy = () => { destroyed = true; };

    process.nextTick(() => {
      mockReq.emit('data', Buffer.alloc(2048));
      if (!paused) mockReq.emit('end');
    });

    await assert.rejects(
      () => bridge.parseJsonBody(mockReq),
      (err) => err.statusCode === 413 && err.message.includes('too large')
    );
    assert.equal(paused, true);
    assert.equal(destroyed, false);
  });

  it('should enforce .ggb extension on handleSave', async () => {
    let savedPath = '';
    const mockWin = {
      isDestroyed: () => false,
      webContents: {
        executeJavaScript: async () => Buffer.from('ggbdata').toString('base64')
      }
    };
    const bridge = new GeoGebraBridge(() => mockWin, { persistToken: false });
    const mockRes = {
      writeHead(status) { this.status = status; },
      end(data) { savedPath = JSON.parse(data).filePath; }
    };

    const tempFile = path.join(os.tmpdir(), `test-save-no-ext-${Date.now()}`);
    await bridge.handleSave({ filePath: tempFile }, mockRes);

    assert.ok(savedPath.endsWith('.ggb'));
    if (fs.existsSync(savedPath)) fs.unlinkSync(savedPath);
  });

  it('should invoke dismissQuickRenamePopup and re-check window state in captureScreenshot', async () => {
    const executedScripts = [];
    let destroyed = false;
    let captureCalled = false;
    const mockWin = {
      isDestroyed: () => destroyed,
      webContents: {
        executeJavaScript: async (js) => {
          executedScripts.push(js);
          destroyed = true; // Simulate window closing right after JS finishes
          return true;
        },
        capturePage: async () => {
          captureCalled = true;
          return { toPNG: () => Buffer.from('png') };
        }
      }
    };
    const bridge = new GeoGebraBridge(() => mockWin, { persistToken: false });
    const img = await bridge.captureScreenshot();
    assert.equal(img, null);
    assert.equal(captureCalled, false);
    assert.ok(executedScripts[0].includes('dismissQuickRenamePopup'));
  });
});

describe('GeoGebra Bridge Live HTTP Security & Protocol Tests', () => {
  const TOKEN = 'unit-test-bridge-secret-token';
  let bridge;
  let port;
  let tempDir;
  let mockObjects = [
    { name: 'A', type: 'point', value: 'A = (0, 0, 0)', definition: '', coords: [0, 0, 0] },
    { name: 'B', type: 'point', value: 'B = (4, 0, 0)', definition: '', coords: [4, 0, 0] }
  ];
  let lastEvalJs = '';

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggb-bridge-test-'));
    const mockWin = {
      isDestroyed: () => false,
      isMinimized: () => false,
      isVisible: () => true,
      restore() {},
      show() {},
      setAlwaysOnTop() {},
      focus() {},
      webContents: {
        executeJavaScript: async (js) => {
          lastEvalJs = js;
          if (js.includes('getObjects()')) return mockObjects;
          if (js.includes('isReady')) return { ready: true, objectCount: mockObjects.length };
          if (js.includes('evalCommands')) return { success: true, executedCount: 1, failedCount: 0, failedCommands: [], totalObjects: 2 };
          if (js.includes('getBase64')) return Buffer.from('mock-ggb').toString('base64');
          if (js.includes('setBase64')) return true;
          return { success: true };
        },
        capturePage: async () => ({ toPNG: () => Buffer.from('fake-png') })
      }
    };

    bridge = new GeoGebraBridge(() => mockWin, {
      port: 0,
      token: TOKEN,
      persistToken: false,
      maxBodySize: 1024
    });
    port = await bridge.start();
  });

  after(() => {
    bridge.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should reject malicious Host headers (DNS rebinding bypass) with 403', async () => {
    for (const badHost of [`localhost.evil.com:${port}`, `127.0.0.1.nip.io:${port}`, `evil.com:${port}`]) {
      const res = await rawHttpRequest({
        port,
        path: '/status',
        headers: { Host: badHost, Authorization: `Bearer ${TOKEN}` }
      });
      assert.equal(res.status, 403, `Expected 403 for Host ${badHost}, got ${res.status}`);
    }
  });

  it('should reject untrusted Origin on both OPTIONS and POST with 403', async () => {
    for (const badOrigin of ['https://evil.com', 'http://localhost.evil.com:3999', 'http://127.0.0.1.nip.io']) {
      const optRes = await rawHttpRequest({
        port,
        method: 'OPTIONS',
        path: '/eval',
        headers: { Host: `127.0.0.1:${port}`, Origin: badOrigin }
      });
      assert.equal(optRes.status, 403, `Expected 403 on OPTIONS for ${badOrigin}`);

      const postRes = await rawHttpRequest({
        port,
        method: 'POST',
        path: '/eval',
        headers: {
          Host: `127.0.0.1:${port}`,
          Origin: badOrigin,
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ commands: ['A=(0,0,0)'] })
      });
      assert.equal(postRes.status, 403, `Expected 403 on POST for ${badOrigin}`);
    }
  });

  it('should allow valid local Origin with Vary: Origin', async () => {
    const res = await rawHttpRequest({
      port,
      method: 'OPTIONS',
      path: '/eval',
      headers: { Host: `127.0.0.1:${port}`, Origin: 'app://local' }
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'app://local');
    assert.equal(res.headers['vary'], 'Origin');
  });

  it('should reject missing or invalid Bearer token with 401', async () => {
    const resNoAuth = await rawHttpRequest({
      port,
      path: '/status',
      headers: { Host: `127.0.0.1:${port}` }
    });
    assert.equal(resNoAuth.status, 401);

    const resBadAuth = await rawHttpRequest({
      port,
      path: '/status',
      headers: { Host: `127.0.0.1:${port}`, Authorization: 'Bearer wrong-token' }
    });
    assert.equal(resBadAuth.status, 401);
  });

  it('should reject POST with text/plain Content-Type (CSRF bypass) with 415', async () => {
    const res = await rawHttpRequest({
      port,
      method: 'POST',
      path: '/eval',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify({ commands: ['A=(0,0,0)'] })
    });
    assert.equal(res.status, 415);
  });

  it('should return clean HTTP 413 response (not socket reset) when body exceeds maxBodySize', async () => {
    const oversizedBody = JSON.stringify({ commands: ['x'.repeat(2048)] });
    const res = await rawHttpRequest({
      port,
      method: 'POST',
      path: '/eval',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(oversizedBody)
      },
      body: oversizedBody
    });
    assert.equal(res.status, 413);
    assert.ok(res.json.error.includes('too large'));
  });

  it('should handle GET /objects?limit=0 by returning 0 objects', async () => {
    const res = await rawHttpRequest({
      port,
      path: '/objects?limit=0',
      headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${TOKEN}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.count, 0);
    assert.deepEqual(res.json.objects, []);
  });

  it('should reject UNC paths, null bytes, and app-root writes on /save and /load', async () => {
    for (const badPath of ['\\\\attacker\\share\\evil.ggb', '//attacker/share/evil.ggb', 'bad\0path.ggb']) {
      const saveRes = await rawHttpRequest({
        port,
        method: 'POST',
        path: '/save',
        headers: {
          Host: `127.0.0.1:${port}`,
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filePath: badPath })
      });
      assert.equal(saveRes.status, 400, `Expected 400 on /save for ${badPath}`);

      const loadRes = await rawHttpRequest({
        port,
        method: 'POST',
        path: '/load',
        headers: {
          Host: `127.0.0.1:${port}`,
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filePath: badPath })
      });
      assert.equal(loadRes.status, 400, `Expected 400 on /load for ${badPath}`);
    }

    const appRootTarget = path.join(__dirname, '..', 'evil.ggb');
    const appSaveRes = await rawHttpRequest({
      port,
      method: 'POST',
      path: '/save',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ filePath: appRootTarget })
    });
    assert.equal(appSaveRes.status, 403);
  });

  it('should reject oversized .ggb files on /load with 413', async () => {
    const bigFile = path.join(tempDir, 'huge.ggb');
    fs.writeFileSync(bigFile, Buffer.alloc(2048));
    const res = await rawHttpRequest({
      port,
      method: 'POST',
      path: '/load',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ filePath: bigFile })
    });
    assert.equal(res.status, 413);
  });

  it('should save and load valid .ggb file inside temp directory', async () => {
    const targetFile = path.join(tempDir, 'valid-scene');
    const saveRes = await rawHttpRequest({
      port,
      method: 'POST',
      path: '/save',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ filePath: targetFile })
    });
    assert.equal(saveRes.status, 200);
    assert.ok(saveRes.json.filePath.endsWith('.ggb'));
    assert.ok(fs.existsSync(saveRes.json.filePath));

    const loadRes = await rawHttpRequest({
      port,
      method: 'POST',
      path: '/load',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ filePath: saveRes.json.filePath })
    });
    assert.equal(loadRes.status, 200);
    assert.ok(lastEvalJs.includes('setBase64'));
  });
});
