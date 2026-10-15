import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile, appendFile, rm, stat } from 'node:fs/promises';
import { tmpdir, freemem } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { chromium, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const output = path.resolve('artifacts');
await mkdir(output, { recursive: true });
const result = {
  scope: 'Execution environment smoke test only; not NocoReach application or connector acceptance.',
  startedAt: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY ?? 'local',
  runId: process.env.GITHUB_RUN_ID ?? null,
  commit: process.env.GITHUB_SHA ?? null,
  runtime: { node: process.version, platform: process.platform, arch: process.arch,
    playwright: require('@playwright/test/package.json').version, freeMemoryBytes: freemem() },
  status: 'running', checks: [], pageErrors: [], consoleErrors: [], blockedRequests: [],
};
let server;
let browser;
let context;
let page;
let tracing = false;
let sandbox;
const run = promisify(execFile);

async function check(name, action) {
  const started = Date.now();
  try {
    const details = await action();
    result.checks.push({ name, status: 'passed', durationMs: Date.now() - started, details });
    console.log('PASS', name, JSON.stringify(details ?? {}));
  } catch (error) {
    result.checks.push({ name, status: 'failed', durationMs: Date.now() - started, error: String(error) });
    throw error;
  }
}

// This is deliberately a small probe page, not a replacement for testing the real product.
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Node and Chromium execution probe</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:780px;margin:64px auto;padding:24px;color:#202936}h1{font-size:28px}label{display:block;font-weight:600}input{padding:10px;width:90%;margin:8px 0}button{padding:10px 16px;cursor:pointer}section{padding:24px;border:1px solid #dce2e8;border-radius:10px}#status{min-height:28px}small{color:#657183}pre{white-space:pre-wrap}</style>
</head><body><h1>Node + Chromium smoke test</h1><p>Real browser, real localhost HTTP server. No external platform connection.</p>
<section><label for="value">Message</label><input id="value" value="" autocomplete="off"><button id="save">Save to local server</button>
<p id="status" role="status" aria-live="polite">Loading local record...</p><pre id="record"></pre></section>
<p><small>Environment probe only. This page is not NocoReach and does not validate its connectors.</small></p>
<script>
const status = document.getElementById('status');
const record = document.getElementById('record');
async function load() {
  const response = await fetch('/api/record');
  if (!response.ok) throw new Error('Record read failed: ' + response.status);
  const data = await response.json();
  record.textContent = data ? JSON.stringify(data, null, 2) : 'No record yet';
  status.textContent = data ? 'Loaded: ' + data.value : 'Ready';
}
document.getElementById('save').addEventListener('click', async () => {
  const button = document.getElementById('save');
  button.disabled = true;
  try {
    const response = await fetch('/api/record', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:document.getElementById('value').value})});
    if (!response.ok) throw new Error('Save failed: ' + response.status);
    const data = await response.json();
    record.textContent = JSON.stringify(data, null, 2);
    status.textContent = 'Saved: ' + data.value;
  } catch (error) { status.textContent = 'Error: ' + error.message; console.error(error); }
  finally { button.disabled = false; }
});
load().catch(error => { status.textContent = 'Error: ' + error.message; console.error(error); });
</script></body></html>`;

try {
  await check('node-runtime', async () => {
    assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Node 24 or newer required');
    console.log('NODE_RUNTIME_OK');
    return { node: process.version };
  });
  await check('filesystem-read-write', async () => {
    sandbox = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'nocoreach-smoke-'));
    const file = path.join(sandbox, 'probe.txt');
    await writeFile(file, 'first\n', 'utf8');
    assert.equal(await readFile(file, 'utf8'), 'first\n');
    await writeFile(file, 'second\n', 'utf8');
    assert.equal(await readFile(file, 'utf8'), 'second\n');
    return { create: true, read: true, overwrite: true };
  });
  await check('node-child-process', async () => {
    const { stdout } = await run(process.execPath, ['-e', 'console.log("NODE_CHILD_OK")'], { timeout: 10000 });
    assert.equal(stdout.trim(), 'NODE_CHILD_OK');
    return { childProcess: stdout.trim() };
  });
  let record = null;
  let writes = 0;
  const recordFile = path.join(output, 'server-record.json');
  await check('localhost-http-server', async () => {
    server = createServer((req, res) => {
      const send = (code, body, type = 'application/json') => {
        res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(type === 'application/json' ? JSON.stringify(body) : body);
      };
      void (async () => {
        if (req.method === 'GET' && req.url === '/') return send(200, html, 'text/html; charset=utf-8');
        if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, node: process.version });
        if (req.method === 'GET' && req.url === '/api/record') return send(200, record);
        if (req.method === 'POST' && req.url === '/api/record') {
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 4096) return send(413, { error: 'Body too large' });
            chunks.push(chunk);
          }
          let input;
          try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { return send(400, { error: 'Invalid JSON' }); }
          if (typeof input?.value !== 'string' || input.value.length > 200) return send(400, { error: 'Invalid value' });
          record = { value: input.value, writes: ++writes, savedAt: new Date().toISOString() };
          await writeFile(recordFile, JSON.stringify(record, null, 2));
          return send(200, record);
        }
        if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        send(404, { error: 'Not found' });
      })().catch(error => {
        console.error('SERVER_ERROR', String(error));
        if (!res.headersSent) send(500, { error: 'Local probe failure' }); else res.destroy();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    result.origin = `http://127.0.0.1:${address.port}`;
    const response = await fetch(result.origin + '/health', { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    return { origin: result.origin, healthStatus: response.status };
  });
  await check('chromium-launch-and-http-navigation', async () => {
    browser = await chromium.launch({ headless: true, timeout: 30000 });
    result.runtime.chromium = browser.version();
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== result.origin) {
        result.blockedRequests.push(route.request().url());
        return route.abort('blockedbyclient');
      }
      await route.continue();
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    tracing = true;
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => result.pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
    const response = await page.goto(result.origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.equal(response?.status(), 200);
    await expect(page.getByRole('heading', { name: 'Node + Chromium smoke test' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Ready');
    await page.screenshot({ path: path.join(output, '01-browser-ready.png'), fullPage: true });
    return { browser: browser.version(), httpStatus: response.status(), navigation: 'page.goto(localhost), not page.setContent' };
  });
  await check('browser-input-click-and-server-persistence', async () => {
    await page.getByLabel('Message', { exact: true }).fill('node-chromium-smoke');
    await page.getByRole('button', { name: 'Save to local server' }).click();
    await expect(page.getByRole('status')).toHaveText('Saved: node-chromium-smoke');
    const diskRecord = JSON.parse(await readFile(recordFile, 'utf8'));
    assert.equal(diskRecord.value, 'node-chromium-smoke');
    assert.equal(diskRecord.writes, 1);
    await page.screenshot({ path: path.join(output, '02-browser-saved.png'), fullPage: true });
    return { value: diskRecord.value, writes: diskRecord.writes, verifiedFromDisk: true };
  });
  await check('browser-reload-and-readback', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('status')).toHaveText('Loaded: node-chromium-smoke');
    const response = await fetch(result.origin + '/api/record', { signal: AbortSignal.timeout(10000) });
    const stored = await response.json();
    assert.equal(stored.value, 'node-chromium-smoke');
    assert.equal(stored.writes, 1);
    await page.screenshot({ path: path.join(output, '03-browser-readback.png'), fullPage: true });
    return { reload: true, readback: true, writes: stored.writes };
  });
  await check('browser-errors-and-screenshot', async () => {
    assert.deepEqual(result.pageErrors, []);
    assert.deepEqual(result.consoleErrors, []);
    assert.deepEqual(result.blockedRequests, []);
    const screenshot = await stat(path.join(output, '03-browser-readback.png'));
    assert.ok(screenshot.size > 1000);
    return { pageErrors: 0, consoleErrors: 0, externalBrowserRequests: 0, screenshotBytes: screenshot.size };
  });
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
  console.error(result.error);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout: 5000 }).catch(() => {});
} finally {
  const cleanupErrors = [];
  async function cleanup(label, action) {
    try { await action(); } catch (error) { cleanupErrors.push({ label, error: String(error) }); }
  }
  if (context && tracing) await cleanup('save-trace', () => context.tracing.stop({ path: path.join(output, 'trace.zip') }));
  if (context) await cleanup('close-context', () => context.close());
  if (browser) await cleanup('close-browser', () => browser.close());
  if (server) await cleanup('close-server', () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  if (sandbox) await cleanup('remove-temporary-probe', () => rm(sandbox, { recursive: true, force: true }));
  if (cleanupErrors.length) { result.cleanupErrors = cleanupErrors; result.status = 'failed'; process.exitCode = 1; }
  result.finishedAt = new Date().toISOString();
  result.passed = result.checks.filter(item => item.status === 'passed').length;
  result.total = result.checks.length;
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  const lines = [
    '# NocoReach execution environment smoke test', '',
    `**Result: ${result.status.toUpperCase()} (${result.passed}/${result.total} executed checks)**`, '',
    result.scope, '',
    `Node: ${result.runtime.node}; Playwright: ${result.runtime.playwright}; Chromium: ${result.runtime.chromium ?? 'not started'}.`, '',
    '| Check | Status | Duration (ms) |', '| --- | --- | --- |',
    ...result.checks.map(item => `| ${item.name} | ${item.status} | ${item.durationMs} |`), '',
    'Artifacts: result.json, smoke.log, three browser screenshots, trace.zip, and the local server record.', '',
    'Only loopback requests are allowed by the probe browser. Dependencies and browser binaries are downloaded during setup.',
    'No NocoReach code is changed or tested by this smoke test; no credentials or real platform writes are involved.', '',
  ];
  await writeFile(path.join(output, 'SUMMARY.md'), lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  console.log('SMOKE_RESULT_BEGIN\n' + JSON.stringify(result, null, 2) + '\nSMOKE_RESULT_END');
}
