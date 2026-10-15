import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(process.argv[2]);
const artifacts = path.resolve(process.argv[3]);
const require = createRequire(path.join(root, 'package.json'));
const { chromium, expect } = require('@playwright/test');
const isolated = await mkdtemp(path.join(tmpdir(), 'nocoreach-connectors-'));
await mkdir(artifacts, { recursive: true });
const username = 'connectorqa';
const password = randomBytes(24).toString('base64url');
const origin = 'http://127.0.0.1:13000';
const config = path.join(isolated, 'config.yml');
await writeFile(config, await readFile(path.join(root, 'config.example.yml'), 'utf8') + '\nnocoreachMock:\n  enabled: true\n  environment: test\n  initializeData: true\njobs:\n  default: memory\n');
const logFile = path.join(artifacts, 'application.log');
let logs = '';
let child;
let browser;
let context;
const report = { scope: 'Real NocoReach application with simulated upstream APIs; no production account or remote writes.', base: '', checks: [], pageErrors: [], failedRequests: [] };
const record = (name, details = {}) => { report.checks.push({ name, passed: true, ...details }); console.log('APP_BROWSER_PASS', name, JSON.stringify(details)); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  child = spawn('pnpm', ['dev'], {
    cwd: root,
    detached: true,
    env: { ...process.env, APP_CONFIG_FILE: config, APP_STORAGE_DIR: path.join(isolated, 'storage'), DB_FILENAME: path.join(isolated, 'database.sqlite'), APP_PUBLIC_ORIGIN: origin, INITIAL_ADMIN_USERNAME: username, INITIAL_ADMIN_EMAIL: 'connector-qa@example.test', INITIAL_ADMIN_PASSWORD: password, SECRETS_KEYS: '1:' + randomBytes(32).toString('hex'), NODE_OPTIONS: '--max-old-space-size=6144' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = chunk => { const text = String(chunk).replaceAll(password, '[synthetic-password]'); logs += text; void appendFile(logFile, text); };
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  child.on('error', error => { logs += '\nSPAWN_ERROR ' + error.message; });
  let base;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Application exited (${child.exitCode}): ${logs.slice(-14000)}`);
    const plain = logs.replace(/\u001b\[[0-9;]*m/g, '');
    const match = plain.match(/Local:\s*(https?:\/\/[^\s]+)/);
    if (match) {
      const printed = new URL(match[1]);
      assert.equal(printed.origin, origin, 'Use the printed Local URL with the configured authentication origin');
      base = printed.href.replace(/\/$/, '');
      try { const response = await fetch(base + '/api/healthz', { signal: AbortSignal.timeout(2500) }); if (response.ok) break; } catch { /* Startup is still in progress. */ }
    }
    await sleep(500);
  }
  if (!base) throw new Error('Application did not print a Local URL: ' + logs.slice(-14000));
  report.base = base;
  const health = await fetch(base + '/api/healthz', { signal: AbortSignal.timeout(10_000) });
  assert.equal(health.status, 200);
  record('real-application-health', { status: health.status, base });

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 500) report.failedRequests.push({ status: response.status(), url: response.url() });
  });
  page.setDefaultTimeout(30_000);
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/Username or email|用户名或邮箱/, { exact: true }).fill(username);
  await page.getByLabel(/Password|密码/, { exact: true }).fill(password);
  const loginResponse = page.waitForResponse(response => response.url().includes('/api/auth/sign-in/'));
  await page.getByRole('button', { name: /^Sign in$|^登录$/ }).click();
  assert.equal((await loginResponse).status(), 200, 'Synthetic test administrator signs in through the actual application');
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
  record('real-login-with-synthetic-admin');
  // Start traces after login so passwords are not retained in the published evidence.
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const mockResponse = page.waitForResponse(response => response.url().includes('/nrMock/status'));
  await page.goto(base + '/connections', { waitUntil: 'domcontentloaded' });
  const mock = await mockResponse;
  assert.equal(mock.status(), 200);
  const mockPayload = await mock.json();
  const mockStatus = mockPayload.data ?? mockPayload;
  assert.equal(mockStatus.globalEnabled, true, 'The server must confirm this is a mock deployment');
  assert.equal(mockStatus.environment, 'test');
  const indicator = page.getByTestId('mock-environment-indicator');
  await indicator.waitFor({ state: 'visible' });
  await expect(indicator).toHaveAttribute('role', 'img');
  await page.locator('[data-source-id="github"]').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(artifacts, 'connections.png'), fullPage: true });
  record('existing-connections-page-and-mock-isolation', { environment: mockStatus.environment });

  const statusResponses = [];
  page.on('response', response => {
    if (response.url().includes('nrGitHub') && response.url().includes('status')) statusResponses.push(response);
  });
  for (const id of ['github', 'github-traffic', 'github-discussions']) {
    const opener = page.locator(`[data-source-id="${id}"]`).getByRole('button');
    await opener.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(artifacts, id + '-connection.png'), fullPage: true });
    await dialog.getByRole('button', { name: /^Close$|^关闭$/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    record('github-connection-dialog-' + id);
  }
  assert.ok(statusResponses.length > 0, 'The UI requested the migrated GitHub resource');
  for (const response of statusResponses) assert.equal(response.status(), 200, 'Migrated GitHub status resource answers successfully');
  record('migrated-github-api-used-by-ui', { successfulResponses: statusResponses.length });
  assert.deepEqual(report.pageErrors, [], 'No uncaught browser exception');
  assert.deepEqual(report.failedRequests, [], 'No server 5xx responses');
  record('no-uncaught-browser-or-server-errors');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  console.error('APP_BROWSER_FAIL', report.error);
  console.error('APPLICATION_LOG_TAIL', logs.slice(-8000));
  const pages = context?.pages() ?? [];
  if (pages[0]) {
    try { await pages[0].screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }); } catch { /* Keep the original error. */ }
    try {
      const text = await pages[0].locator('body').innerText();
      await writeFile(path.join(artifacts, 'failure-dom.txt'), text);
      console.error('FAILURE_PAGE', pages[0].url(), text.slice(0, 8000));
    } catch { /* Keep the original error. */ }
  }
  process.exitCode = 1;
} finally {
  if (context) {
    try { await context.tracing.stop({ path: path.join(artifacts, 'browser-trace.zip') }); } catch { /* No trace exists before login. */ }
    await context.close();
  }
  if (browser) await browser.close();
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
    await sleep(800);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already stopped. */ }
  }
  await writeFile(path.join(artifacts, 'browser-result.json'), JSON.stringify(report, null, 2));
  console.log('APP_BROWSER_RESULT', JSON.stringify(report));
  await rm(isolated, { recursive: true, force: true });
}
