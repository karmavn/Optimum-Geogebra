/**
 * Per-session Bearer token management for the local GeoGebra HTTP bridge.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function getTokenDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'geogebra-quick-rename');
  }
  return path.join(os.homedir(), '.config', 'geogebra-quick-rename');
}

function getTokenFilePath(port) {
  return path.join(getTokenDir(), `bridge-${port}.token`);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function writeBridgeToken(port, token) {
  const dir = getTokenDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = getTokenFilePath(port);
  fs.writeFileSync(filePath, token, { encoding: 'utf8', mode: 0o600 });
  return filePath;
}

function readBridgeToken(port) {
  if (process.env.GEOGEBRA_MCP_TOKEN) {
    return process.env.GEOGEBRA_MCP_TOKEN.trim();
  }
  try {
    return fs.readFileSync(getTokenFilePath(port), 'utf8').trim() || null;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return null;
  }
}

function removeBridgeToken(port, expectedToken) {
  const filePath = getTokenFilePath(port);
  try {
    if (expectedToken) {
      const current = fs.readFileSync(filePath, 'utf8').trim();
      if (current !== expectedToken) return;
    }
    fs.unlinkSync(filePath);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      console.warn('[BridgeAuth] Failed to remove token file:', err.message);
    }
  }
}

function verifyBearerToken(authHeader, expectedToken) {
  if (typeof authHeader !== 'string' || typeof expectedToken !== 'string' || !expectedToken) {
    return false;
  }
  if (!authHeader.startsWith('Bearer ')) {
    return false;
  }
  const provided = authHeader.slice('Bearer '.length).trim();
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expectedToken, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  getTokenDir,
  getTokenFilePath,
  generateToken,
  writeBridgeToken,
  readBridgeToken,
  removeBridgeToken,
  verifyBearerToken
};
