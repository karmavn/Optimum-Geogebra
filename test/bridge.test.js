const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const GeoGebraBridge = require('../src/geogebra-bridge.js');

describe('GeoGebra Bridge Unit Tests', () => {
  it('should parse valid JSON body', async () => {
    const bridge = new GeoGebraBridge(() => null);
    const mockReq = {
      on(event, handler) {
        if (event === 'data') {
          handler(Buffer.from(JSON.stringify({ test: 'ok' })));
        }
        if (event === 'end') {
          handler();
        }
        return this;
      }
    };

    const parsed = await bridge.parseJsonBody(mockReq);
    assert.deepEqual(parsed, { test: 'ok' });
  });

  it('should reject invalid JSON body with 400 status', async () => {
    const bridge = new GeoGebraBridge(() => null);
    const mockReq = {
      on(event, handler) {
        if (event === 'data') {
          handler(Buffer.from('invalid-json{'));
        }
        if (event === 'end') {
          handler();
        }
        return this;
      }
    };

    await assert.rejects(async () => {
      await bridge.parseJsonBody(mockReq);
    }, (err) => {
      assert.equal(err.statusCode, 400);
      assert.ok(err.message.includes('Invalid JSON'));
      return true;
    });
  });

  it('should reject bodies exceeding MAX_BODY_SIZE with 413 status', async () => {
    const bridge = new GeoGebraBridge(() => null);
    let destroyed = false;
    const mockReq = {
      destroy() {
        destroyed = true;
      },
      on(event, handler) {
        if (event === 'data') {
          // Send 11MB chunk
          const largeChunk = Buffer.alloc(11 * 1024 * 1024);
          handler(largeChunk);
        }
        return this;
      }
    };

    await assert.rejects(async () => {
      await bridge.parseJsonBody(mockReq);
    }, (err) => {
      assert.equal(err.statusCode, 413);
      assert.ok(err.message.includes('too large'));
      assert.equal(destroyed, true);
      return true;
    });
  });
});
