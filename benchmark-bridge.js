/**
 * Benchmark Script for GeoGebra Bridge & MCP Performance
 * Measures endpoint latency and fingerprints responses
 */
const crypto = require('crypto');

const PORT = 3999;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function run() {
  console.log('=== GEO GEBRA BRIDGE BENCHMARK ===');

  // Check if bridge is running
  try {
    const statusRes = await fetch(`${BASE_URL}/status`);
    const statusData = await statusRes.json();
    if (!statusData.running || !statusData.appletReady) {
      console.error('Bridge is running but GeoGebra applet is not ready.');
      process.exit(1);
    }
  } catch (err) {
    console.error('Bridge is not running on port', PORT, err.message);
    process.exit(1);
  }

  // 1. Benchmark GET /status (10 iterations)
  const statusTimes = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/status`);
    await res.json();
    statusTimes.push(performance.now() - t0);
  }
  statusTimes.sort((a, b) => a - b);
  const medianStatus = statusTimes[Math.floor(statusTimes.length / 2)];
  console.log(`GET /status (10 runs)  : Median ${medianStatus.toFixed(2)} ms (Min: ${statusTimes[0].toFixed(2)}, Max: ${statusTimes[statusTimes.length - 1].toFixed(2)})`);

  // 2. Benchmark POST /pyramid (5 iterations)
  const pyramidPayload = {
    type: 'chop_deu',
    base_shape: 'hinh_vuong',
    dimensions: { a: 4, h: 5 },
    extra_points: [{ name: 'M', midpoint_of: ['S', 'C'] }]
  };

  const pyramidTimes = [];
  let lastPyramidResult = null;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/pyramid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pyramidPayload)
    });
    lastPyramidResult = await res.json();
    pyramidTimes.push(performance.now() - t0);
  }
  pyramidTimes.sort((a, b) => a - b);
  const medianPyramid = pyramidTimes[Math.floor(pyramidTimes.length / 2)];
  console.log(`POST /pyramid (5 runs) : Median ${medianPyramid.toFixed(2)} ms (Min: ${pyramidTimes[0].toFixed(2)}, Max: ${pyramidTimes[pyramidTimes.length - 1].toFixed(2)})`);

  // 3. Benchmark GET /screenshot (5 iterations)
  const screenshotTimes = [];
  let lastScreenshot = null;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/screenshot`);
    lastScreenshot = await res.json();
    screenshotTimes.push(performance.now() - t0);
  }
  screenshotTimes.sort((a, b) => a - b);
  const medianScreenshot = screenshotTimes[Math.floor(screenshotTimes.length / 2)];
  console.log(`GET /screenshot (5 runs): Median ${medianScreenshot.toFixed(2)} ms (Min: ${screenshotTimes[0].toFixed(2)}, Max: ${screenshotTimes[screenshotTimes.length - 1].toFixed(2)})`);

  // 4. Benchmark GET /objects (5 iterations)
  const objectsTimes = [];
  let lastObjects = null;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/objects`);
    lastObjects = await res.json();
    objectsTimes.push(performance.now() - t0);
  }
  objectsTimes.sort((a, b) => a - b);
  const medianObjects = objectsTimes[Math.floor(objectsTimes.length / 2)];
  console.log(`GET /objects (5 runs)   : Median ${medianObjects.toFixed(2)} ms (Min: ${objectsTimes[0].toFixed(2)}, Max: ${objectsTimes[objectsTimes.length - 1].toFixed(2)})`);

  // 5. Fingerprints
  console.log('\n=== BEHAVIORAL & MATHEMATICAL FINGERPRINTS ===');
  const mathData = {
    explanation: lastPyramidResult.explanation,
    points: lastPyramidResult.points,
    foot: lastPyramidResult.foot,
    baseArea: lastPyramidResult.baseArea,
    height: lastPyramidResult.height,
    volume: lastPyramidResult.volume,
    volumeFormula: lastPyramidResult.volumeFormula,
    commands: lastPyramidResult.commands
  };
  const mathJson = JSON.stringify(mathData);
  const mathHash = sha256(mathJson);
  console.log(`Pyramid Math Hash      : ${mathHash}`);
  console.log(`Pyramid Object Count   : ${lastObjects.count}`);
  console.log(`Object Names           : ${lastObjects.objects.map(o => o.name).join(', ')}`);

  console.log('\nBenchmark completed successfully.');
}

run().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
