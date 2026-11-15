# Comprehensive Benchmark & Behavioral Fingerprint Script for GeoGebra Quick Rename
param(
    [int]$Runs = 5
)

$ErrorActionPreference = "Stop"

Write-Host "=== ENVIRONMENT ==="
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name).Trim()
$ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 2)
$os = (Get-CimInstance Win32_OperatingSystem).Caption.Trim()
$nodeVer = (node -v).Trim()
$electronVer = (Get-Content "node_modules\electron\dist\version" -Raw).Trim()
Write-Host "OS       : $os"
Write-Host "CPU      : $cpu"
Write-Host "RAM      : $ramGB GB"
Write-Host "Node     : $nodeVer"
Write-Host "Electron : v$electronVer"
Write-Host "Runs     : $Runs"

Write-Host "`n=== STATIC CODE SIZES & FINGERPRINTS ==="
$files = @(
    "index.html",
    "main.js",
    "preload.js",
    "styles.css",
    "src\quick-rename.js",
    "src\geogebra-bridge.js",
    "src\pyramid-builder.js",
    "mcp-server.js",
    "run-electron.js"
)
$totalBytes = 0
foreach ($f in $files) {
    if (Test-Path $f) {
        $item = Get-Item $f
        $hash = (Get-FileHash -Path $f -Algorithm SHA256).Hash.Substring(0, 16)
        $totalBytes += $item.Length
        Write-Host ("{0,-20} : {1,6} bytes | SHA256: {2}" -f $f, $item.Length, $hash)
    }
}
Write-Host ("{0,-20} : {1,6} bytes" -f "TOTAL APP CODE", $totalBytes)

Write-Host "`n=== OFFLINE BUNDLE FOOTPRINT ==="
Get-ChildItem "geogebra-offline\GeoGebra\HTML5\5.0" -Directory | ForEach-Object {
    $all = Get-ChildItem $_.FullName -Recurse -File
    $sizeMB = [math]::Round(($all | Measure-Object -Property Length -Sum).Sum / 1MB, 2)
    Write-Host ("{0,-12} : {1,4} files | {2,6} MB" -f $_.Name, $all.Count, $sizeMB)
}

Write-Host "`n=== SYNTAX VALIDATION ==="
foreach ($js in @("main.js", "preload.js", "src\quick-rename.js", "src\geogebra-bridge.js", "src\pyramid-builder.js", "mcp-server.js", "run-electron.js")) {
    $res = node --check $js 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Syntax check passed: $js"
    } else {
        Write-Host "Syntax check FAILED: $js -> $res"
        exit 1
    }
}

Write-Host "`n=== RUNTIME BENCHMARK & BEHAVIORAL FINGERPRINT ==="
$env:BENCH_RUNS = "$Runs"
@'
const { spawn, execSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');

const runs = Math.max(1, parseInt(process.env.BENCH_RUNS || '5', 10));
const repoDir = process.cwd();
const electronExe = path.join(repoDir, 'node_modules', 'electron', 'dist', 'electron.exe');

function getProcessTreeWorkingSetMB(rootPid) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "$p=Get-CimInstance Win32_Process; $ids=@(${rootPid}); $added=$true; while($added){$added=$false; foreach($x in $p){if($ids -contains $x.ParentProcessId -and $ids -notcontains $x.ProcessId){$ids+=$x.ProcessId; $added=$true}}}; $ws=0; foreach($id in $ids){$proc=Get-Process -Id $id -ErrorAction SilentlyContinue; if($proc){$ws+=$proc.WorkingSet64}}; [math]::Round($ws/1MB, 2)"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return parseFloat(out) || 0;
  } catch {
    return 0;
  }
}

async function waitForTarget(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Timed out waiting for CDP target');
}

function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();

    ws.addEventListener('open', () => {
      resolve({
        ws,
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        on(method, fn) {
          if (!listeners.has(method)) listeners.set(method, []);
          listeners.get(method).push(fn);
        },
        close() {
          try { ws.close(); } catch {}
        },
      });
    }, { once: true });

    ws.addEventListener('error', reject, { once: true });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      } else if (msg.method && listeners.has(msg.method)) {
        for (const fn of listeners.get(msg.method)) fn(msg.params);
      }
    });
  });
}

function metricMap(perfResult) {
  const m = {};
  for (const item of perfResult.metrics) m[item.name] = item.value;
  return m;
}

async function runSingle(port, { cpuRate = 1, testBehavior = false } = {}) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const t0 = performance.now();
  const child = spawn(electronExe, [repoDir, `--remote-debugging-port=${port}`], {
    stdio: ['ignore', 'ignore', 'ignore'],
    env,
  });

  try {
    const target = await waitForTarget(port);
    const tTargetMs = Math.round(performance.now() - t0);
    const cdp = await connectCDP(target.webSocketDebuggerUrl);

    if (cpuRate > 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    }

    const reqUrls = new Map();
    const externalRequests = [];
    const failedRequests = [];
    const consoleErrors = [];

    cdp.on('Network.requestWillBeSent', (p) => {
      reqUrls.set(p.requestId, p.request.url);
      if (/^https?:/i.test(p.request.url)) externalRequests.push(p.request.url);
    });
    cdp.on('Network.loadingFailed', (p) => {
      failedRequests.push({ url: reqUrls.get(p.requestId), errorText: p.errorText });
    });
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') {
        consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
      }
    });

    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Performance.enable');

    let tAppletReadyMs = null;
    let tInteractiveMs = null;
    let tOverlayRemovedMs = null;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const hasApi = typeof ggbApiInstance !== 'undefined' && ggbApiInstance !== null;
          const ov = document.getElementById('loading-overlay');
          const ovNonBlocking = !ov || getComputedStyle(ov).pointerEvents === 'none';
          return { hasApi, ovRemoved: !ov, ovNonBlocking };
        })()`,
        returnByValue: true,
      });
      const v = r.result.value;
      const now = Math.round(performance.now() - t0);
      if (v.hasApi && tAppletReadyMs === null) tAppletReadyMs = now;
      if (v.hasApi && v.ovNonBlocking && tInteractiveMs === null) tInteractiveMs = now;
      if (v.hasApi && v.ovRemoved && tOverlayRemovedMs === null) {
        tOverlayRemovedMs = now;
        break;
      }
      await new Promise((res) => setTimeout(res, 20));
    }

    await new Promise((res) => setTimeout(res, 250));
    const workingSetMB = getProcessTreeWorkingSetMB(child.pid);
    const m1 = metricMap(await cdp.send('Performance.getMetrics'));

    const navEval = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const scaler = document.querySelector('.applet_scaler');
        const evC = Array.from(document.querySelectorAll('canvas')).find(c => c.getBoundingClientRect().width > 200);
        const evRect = evC ? evC.getBoundingClientRect() : null;
        return {
          domInteractiveMs: nav ? Math.round(nav.domInteractive) : null,
          domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
          loadEventEndMs: nav ? Math.round(nav.loadEventEnd) : null,
          scalerTransform: scaler ? getComputedStyle(scaler).transform : null,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          evCanvasW: evRect ? Math.round(evRect.width) : null,
          evCanvasH: evRect ? Math.round(evRect.height) : null,
        };
      })()`,
      returnByValue: true,
    });

    // Benchmark 50 Quick Rename popup open/close cycles and 60 resize dispatches
    const micro = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        ggbApiInstance.evalCommand('A=(2,1)');
        ggbApiInstance.evalCommand('B=(-2,-1)');
        const canvas = Array.from(document.querySelectorAll('canvas')).find(c => c.getBoundingClientRect().width > 200) || document.body;
        // Measure 50 popup open+close cycles triggered through contextmenu after select
        const tQr0 = performance.now();
        for (let i = 0; i < 50; i++) {
          const rect = canvas.getBoundingClientRect();
          // Simulate click listener / select via GeoGebra listener or direct click on canvas if selected
          if (typeof ggbApiInstance.setCoords === 'function') {
            canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
          }
          // Dispatch contextmenu on window only after selecting via click listener if available; fallback measures DOM popup when triggered
          canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 100, clientY: rect.top + 100 }));
          window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 }));
        }
        const tQrMs = performance.now() - tQr0;

        // Measure 60 rapid resize events (sync cost)
        const tRz0 = performance.now();
        for (let i = 0; i < 60; i++) {
          window.dispatchEvent(new Event('resize'));
        }
        const tRzMs = performance.now() - tRz0;
        return {
          qrDispatch50Ms: Math.round(tQrMs * 100) / 100,
          resize60SyncMs: Math.round(tRzMs * 100) / 100,
        };
      })()`,
      returnByValue: true,
    });
    const m2 = metricMap(await cdp.send('Performance.getMetrics'));

    let behavior = null;
    if (testBehavior) {
      // Real interactive flow via CDP mouse & keyboard events
      await cdp.send('Runtime.evaluate', { expression: `ggbApiInstance.setMode(0);` });
      // Click neutral area to dismiss any virtual keyboard
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 120, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500, y: 120, button: 'left', buttons: 0, clickCount: 1 });
      await new Promise((r) => setTimeout(r, 350));

      const coordsRes = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const xml = ggbApiInstance.getXML();
          const evSize = xml.match(/<euclidianView>[\\s\\S]*?<size width="([^"]+)" height="([^"]+)"\\/>/);
          const cs = xml.match(/coordSystem xZero="([^"]+)" yZero="([^"]+)" scale="([^"]+)"/);
          const evC = Array.from(document.querySelectorAll('canvas')).find(c => c.getBoundingClientRect().width > 200);
          const rect = evC.getBoundingClientRect();
          const xZero = parseFloat(cs[1]), yZero = parseFloat(cs[2]), s = parseFloat(cs[3]);
          const sx = rect.width / parseFloat(evSize[1]), sy = rect.height / parseFloat(evSize[2]);
          return {
            ax: Math.round(rect.left + (xZero + 2 * s) * sx),
            ay: Math.round(rect.top + (yZero - 1 * s) * sy),
          };
        })()`,
        returnByValue: true,
      });
      const { ax, ay } = coordsRes.result.value;

      // Helper to left-click then right-click point at (ax, ay)
      async function openPopupAt(x, y) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
        await new Promise((r) => setTimeout(r, 50));
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
        await new Promise((r) => setTimeout(r, 80));
      }

      // Measure 10 real open+close popup cycles via actual input events for accurate DOM/layout cost
      const tRealOpen0 = performance.now();
      for (let i = 0; i < 10; i++) {
        await openPopupAt(ax, ay);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      }
      const realPopup10CyclesMs = Math.round(performance.now() - tRealOpen0);

      // Step 1: Open popup on A
      await openPopupAt(ax, ay);
      const step1 = (await cdp.send('Runtime.evaluate', {
        expression: `({
          visible: getComputedStyle(document.querySelector('.quick-rename-popup')).display !== 'none',
          badge: document.getElementById('qr-badge-text')?.textContent?.trim(),
          current: document.getElementById('qr-current-name')?.textContent?.trim(),
          inputVal: document.getElementById('qr-input')?.value,
          chips: Array.from(document.querySelectorAll('#qr-chips .chip-btn')).filter(b => !b.hidden && getComputedStyle(b).display !== 'none').map(b => b.textContent),
        })`,
        returnByValue: true,
      })).result.value;

      // Step 2: Duplicate name 'B' rejection
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const inp = document.getElementById('qr-input');
          inp.value = 'B';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        })()`,
      });
      const step2 = (await cdp.send('Runtime.evaluate', {
        expression: `({
          stillVisible: getComputedStyle(document.querySelector('.quick-rename-popup')).display !== 'none',
          existsA: ggbApiInstance.exists('A'),
          hasTitleWarning: Boolean(document.getElementById('qr-input')?.getAttribute('title')),
        })`,
        returnByValue: true,
      })).result.value;

      // Step 3: Escape cancels without renaming
      await cdp.send('Runtime.evaluate', {
        expression: `document.getElementById('qr-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
      });
      const step3 = (await cdp.send('Runtime.evaluate', {
        expression: `({
          visibleAfterEsc: getComputedStyle(document.querySelector('.quick-rename-popup')).display !== 'none',
          existsA: ggbApiInstance.exists('A'),
        })`,
        returnByValue: true,
      })).result.value;

      // Step 4: Reopen and rename A -> M via Enter
      await openPopupAt(ax, ay);
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const inp = document.getElementById('qr-input');
          inp.value = 'M';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        })()`,
      });
      const step4 = (await cdp.send('Runtime.evaluate', {
        expression: `({
          visibleAfterEnter: getComputedStyle(document.querySelector('.quick-rename-popup')).display !== 'none',
          existsA: ggbApiInstance.exists('A'),
          existsM: ggbApiInstance.exists('M'),
          mx: ggbApiInstance.getXcoord('M'),
          my: ggbApiInstance.getYcoord('M'),
        })`,
        returnByValue: true,
      })).result.value;

      // Step 5: Reopen on M and click chip M'
      await openPopupAt(ax, ay);
      const step5Chips = (await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const btns = Array.from(document.querySelectorAll('#qr-chips .chip-btn')).filter(b => !b.hidden && getComputedStyle(b).display !== 'none');
          const chips = btns.map(b => b.textContent);
          const mPrimeBtn = btns.find(b => b.textContent === "M'");
          if (mPrimeBtn) mPrimeBtn.click();
          return {
            chipsBeforeClick: chips,
            visibleAfterChip: getComputedStyle(document.querySelector('.quick-rename-popup')).display !== 'none',
            existsM: ggbApiInstance.exists('M'),
            existsMPrime: ggbApiInstance.exists("M'"),
            mpx: ggbApiInstance.getXcoord("M'"),
            mpy: ggbApiInstance.getYcoord("M'"),
            allObjects: ggbApiInstance.getAllObjectNames().sort(),
            electronApiKeys: window.electronAPI ? Object.keys(window.electronAPI).sort() : [],
          };
        })()`,
        returnByValue: true,
      })).result.value;

      // Step 6: Base64 serialization check
      const b64Check = (await cdp.send('Runtime.evaluate', {
        expression: `new Promise(res => ggbApiInstance.getBase64(b => res({ hasBase64: typeof b === 'string' && b.length > 100 })))`,
        awaitPromise: true,
        returnByValue: true,
      })).result.value;

      const payload = { step1, step2, step3, step4, step5Chips, b64Check };
      const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
      behavior = { realPopup10CyclesMs, payload, sha256: hash };
    }

    cdp.close();
    return {
      tTargetMs,
      ...navEval.result.value,
      firstMeaningfulPaintMs: Math.round((m1.FirstMeaningfulPaint - m1.NavigationStart) * 1000),
      tAppletReadyMs,
      tInteractiveMs,
      tOverlayRemovedMs,
      scriptDurationMs: Math.round(m1.ScriptDuration * 1000),
      v8CompileDurationMs: Math.round(m1.V8CompileDuration * 1000),
      layoutCount: m1.LayoutCount,
      recalcStyleCount: m1.RecalcStyleCount,
      layoutDurationMs: Math.round(m1.LayoutDuration * 100000) / 100,
      jsHeapUsedMB: Math.round(m1.JSHeapUsedSize / 1048576 * 100) / 100,
      workingSetMB,
      resize60SyncMs: micro.result.value.resize60SyncMs,
      microLayoutDelta: m2.LayoutCount - m1.LayoutCount,
      microStyleDelta: m2.RecalcStyleCount - m1.RecalcStyleCount,
      externalRequestsCount: externalRequests.length,
      failedRequestsCount: failedRequests.length,
      consoleErrorCount: consoleErrors.length,
      behavior,
    };
  } finally {
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  }
}

function summarize(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100;
  return { median, min: s[0], max: s[s.length - 1] };
}

(async () => {
  const results = [];
  for (let i = 0; i < runs; i++) {
    const r = await runSingle(9230 + i, { testBehavior: i === runs - 1 });
    results.push(r);
  }
  const throttled = await runSingle(9245, { cpuRate: 4 });

  const keys = [
    'tTargetMs', 'domInteractiveMs', 'domContentLoadedMs', 'firstMeaningfulPaintMs',
    'tAppletReadyMs', 'tInteractiveMs', 'tOverlayRemovedMs',
    'scriptDurationMs', 'v8CompileDurationMs', 'layoutDurationMs', 'layoutCount', 'recalcStyleCount',
    'jsHeapUsedMB', 'workingSetMB', 'resize60SyncMs', 'microLayoutDelta', 'microStyleDelta'
  ];

  console.log('Metric                         | Median   | Min      | Max');
  console.log('-------------------------------|----------|----------|---------');
  for (const k of keys) {
    const s = summarize(results.map((r) => r[k]).filter((v) => typeof v === 'number'));
    console.log(`${k.padEnd(30)} | ${String(s.median).padStart(8)} | ${String(s.min).padStart(8)} | ${String(s.max).padStart(8)}`);
  }

  const last = results[results.length - 1];
  console.log('\n=== VIEWPORT / SCALER / NETWORK CHECK ===');
  console.log({
    scalerTransform: last.scalerTransform,
    innerSize: `${last.innerWidth}x${last.innerHeight}`,
    evCanvasSize: `${last.evCanvasW}x${last.evCanvasH}`,
    externalRequestsMax: Math.max(...results.map((r) => r.externalRequestsCount)),
    failedRequestsMax: Math.max(...results.map((r) => r.failedRequestsCount)),
    consoleErrorsMax: Math.max(...results.map((r) => r.consoleErrorCount)),
  });

  console.log('\n=== 4X CPU THROTTLED RUN (ITEM #31) ===');
  console.log({
    tTargetMs: throttled.tTargetMs,
    tAppletReadyMs: throttled.tAppletReadyMs,
    tInteractiveMs: throttled.tInteractiveMs,
    scriptDurationMs: throttled.scriptDurationMs,
    v8CompileDurationMs: throttled.v8CompileDurationMs,
    resize60SyncMs: throttled.resize60SyncMs,
  });

  console.log('\n=== BEHAVIORAL FINGERPRINT ===');
  console.log(JSON.stringify(last.behavior, null, 2));
})();
'@ | node
