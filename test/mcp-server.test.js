const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const {
  cleanBase64,
  DRAW_PYRAMID_SCHEMA,
  buildWindowsTaskScript,
  createSingleFlightLauncher,
  createMcpServer
} = require('../mcp-server.js');

describe('MCP Server Unit Tests', () => {
  it('cleanBase64 should strip data URI prefix and handle empty values', () => {
    assert.equal(cleanBase64('data:image/png;base64,ABC123'), 'ABC123');
    assert.equal(cleanBase64('RAW_BASE64'), 'RAW_BASE64');
    assert.equal(cleanBase64(''), '');
    assert.equal(cleanBase64(null), '');
  });

  it('createSingleFlightLauncher should deduplicate concurrent launches and reset after settlement', async () => {
    let calls = 0;
    let release;
    const launcher = createSingleFlightLauncher(() => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    });

    const p1 = launcher();
    const p2 = launcher();
    assert.equal(p1, p2);
    assert.equal(calls, 1);

    release(true);
    assert.equal(await p1, true);
    assert.equal(await p2, true);

    const p3 = launcher();
    assert.equal(calls, 2);
    release(true);
    await p3;
  });

  it('DRAW_PYRAMID_SCHEMA should validate Zod v4 constraints cleanly', () => {
    assert.ok(DRAW_PYRAMID_SCHEMA);
    const schema = z.object(DRAW_PYRAMID_SCHEMA);

    // Valid inputs including opacity: 0 and omitted base_shape for chop_deu
    assert.ok(schema.safeParse({ type: 'chop_deu', opacity: 0, dimensions: { a: 4, h: 5 } }).success);
    assert.ok(schema.safeParse({
      type: 'tam_giac',
      base_shape: 'tam_giac_vuong_A',
      extra_points: [{ name: 'M', coords: [1, 2, 3] }],
      planes: [{ points: ['A', 'B', 'S'], opacity: 0 }]
    }).success);

    // Invalid inputs
    assert.equal(schema.safeParse({ type: 'custom', base_shape: 'tam_giac_vuong_A' }).success, false);
    assert.equal(schema.safeParse({ type: 'tam_giac', base_shape: 'tam_giac_vuong_A', height_type: 'custom' }).success, false);
    assert.equal(schema.safeParse({ type: 'tam_giac', base_shape: 'tam_giac_vuong_A', dimensions: { a: -1 } }).success, false);
    assert.equal(schema.safeParse({ type: 'tam_giac', base_shape: 'tam_giac_vuong_A', dimensions: { h: 0 } }).success, false);
    assert.equal(schema.safeParse({ type: 'tam_giac', base_shape: 'tam_giac_vuong_A', opacity: 2 }).success, false);
    assert.equal(schema.safeParse({
      type: 'tam_giac',
      base_shape: 'tam_giac_vuong_A',
      extra_points: [{ name: 'M', coords: [1, 2] }]
    }).success, false);
  });

  it('buildWindowsTaskScript should escape single quotes and pass port argument', () => {
    const script = buildWindowsTaskScript("C:\\User's App\\start-geogebra.bat", 4567);
    assert.ok(script.includes("C:\\User''s App\\start-geogebra.bat"));
    assert.ok(script.includes("$portArg = '4567'"));
    assert.ok(script.includes('-Argument $portArg'));
    assert.ok(script.includes('LaunchGeoGebraOnDesktop'));
  });

  it('createMcpServer should register all 9 tools without Zod v4 schema errors', () => {
    const server = createMcpServer();
    assert.ok(server);
  });
});
