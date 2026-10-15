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
const messages = JSON.parse(await readFile(path.join(root, 'shared/i18n/en.json'), 'utf8'));
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
const report = { scope: 'Real NocoReach application with simulated upstream APIs. This verifies only the connector packages listed in the checks, not the unfinished full migration.', base: '', checks: [], pageErrors: [], failedRequests: [] };
const record = (name, details = {}) => { report.checks.push({ name, passed: true, ...details }); console.log('APP_BROWSER_PASS', name, JSON.stringify(details)); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const targets = [
  { card: 'github', resource: 'nrGitHub', action: 'sync', button: 'common.syncNow', metric: status => status.latest?.stars },
  { card: 'github-traffic', resource: 'nrGitHub' },
  { card: 'github-discussions', resource: 'nrGitHub' },
  { card: 'discourse', resource: 'nrCommunity', action: 'sync', button: 'common.syncNow', metric: status => status.total },
  { card: 'packages', resource: 'nrPackages', action: 'sync', button: 'common.syncNow', metric: status => status.packages?.length },
  { card: 'mentions', resource: 'nrHackerNews', action: 'sync', button: 'common.syncNow', metric: status => status.total },
  { card: 'social', resource: 'nrX', action: 'check', button: 'common.searchNow', metric: status => status.total },
  { card: 'discord', resource: 'nrChat', action: 'sync', button: 'common.readNow', platform: 'discord', metric: status => status.discord?.channels?.length },
  { card: 'slack', resource: 'nrChat', action: 'sync', button: 'common.readNow', platform: 'slack', metric: status => status.slack?.channels?.length },
];

try {
  child = spawn('pnpm', ['dev'], {
    cwd: root, detached: true,
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
  assert.equal((await fetch(base + '/api/healthz', { signal: AbortSignal.timeout(10_000) })).status, 200);
  record('real-application-health', { status: 200, base });

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('response', response => { if (response.status() >= 500) report.failedRequests.push({ status: response.status(), url: response.url() }); });
  page.setDefaultTimeout(30_000);
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/Username or email|用户名或邮箱/, { exact: true }).fill(username);
  await page.getByLabel(/Password|密码/, { exact: true }).fill(password);
  const loginResponse = page.waitForResponse(response => response.url().includes('/api/auth/sign-in/'));
  await page.getByRole('button', { name: /^Sign in$|^登录$/ }).click();
  assert.equal((await loginResponse).status(), 200);
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
  record('real-login-with-synthetic-admin');
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  await page.goto(base + '/connections', { waitUntil: 'domcontentloaded' });
  const indicator = page.getByTestId('mock-environment-indicator');
  await indicator.waitFor({ state: 'visible' });
  await expect(indicator).toHaveAttribute('role', 'img');
  await page.locator('[data-source-id="github"]').waitFor({ state: 'visible' });
  async function status(resource) {
    const result = await page.evaluate(async ({ url }) => {
      const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: '1' }) });
      return { status: response.status, body: await response.json() };
    }, { url: base + '/api/nocoreach/' + resource + '/status' });
    assert.equal(result.status, 200, resource + ': ' + JSON.stringify(result.body));
    return result.body.data ?? result.body;
  }
  const mockStatus = await status('nrMock');
  assert.equal(mockStatus.globalEnabled, true);
  assert.equal(mockStatus.environment, 'test');
  record('existing-connections-page-and-mock-isolation', { environment: mockStatus.environment });
  await page.screenshot({ path: path.join(artifacts, 'connections.png'), fullPage: true });

  for (const target of targets) {
    await page.locator(`[data-source-id="${target.card}"]`).getByRole('button').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    const before = await status(target.resource);
    assert.equal(target.platform ? before[target.platform]?.connected : before.connected, true, target.card + ' should have a seeded connection');
    if (target.action) {
      const label = messages[target.button];
      assert.equal(typeof label, 'string', 'Use the actual application translation key');
      const button = dialog.getByRole('button', { name: label, exact: true });
      await expect(button).toBeEnabled({ timeout: 60_000 });
      const responsePromise = page.waitForResponse(response => response.url().includes(`/${target.resource}/${target.action}`), { timeout: 60_000 });
      await button.click();
      assert.equal((await responsePromise).status(), 200, target.card + ' sync HTTP result');
      let after = await status(target.resource);
      const finish = Date.now() + 60_000;
      while ((after.syncing || after.checking) && Date.now() < finish) { await sleep(500); after = await status(target.resource); }
      assert.ok(!after.syncing && !after.checking, target.card + ' background read must complete');
      // GitHub's lastSync is a receipt; several other readers use lastSync only as an ISO timestamp.
      const lastRun = target.platform ? after[target.platform]?.lastRun
        : after.lastSync && typeof after.lastSync === 'object' ? after.lastSync : after.lastRun;
      assert.equal(lastRun?.ok, true, target.card + ' must report a successful structured receipt: ' + JSON.stringify(lastRun));
      assert.ok(Number(target.metric(after)) > 0, target.card + ' should expose nonempty fixture data after reading');
      const again = await status(target.resource);
      assert.equal(target.metric(again), target.metric(after), target.card + ' results persist across subsequent status reads');
      record('ui-read-and-persisted-result-' + target.card, { resource: target.resource, action: target.action, metric: target.metric(after) });
    }
    await expect(dialog.locator('.nr-error[role="alert"]')).toHaveCount(0);
    await page.screenshot({ path: path.join(artifacts, target.card + '-connection.png'), fullPage: true });
    await dialog.getByRole('button', { name: /^Close$|^关闭$/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    record('connection-dialog-' + target.card);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-source-id="github"]').waitFor({ state: 'visible' });
  assert.equal((await status('nrGitHub')).connected, true);
  record('page-reload-retains-real-server-state');
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.failedRequests, []);
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
    try { const text = await pages[0].locator('body').innerText(); await writeFile(path.join(artifacts, 'failure-dom.txt'), text); console.error('FAILURE_PAGE', pages[0].url(), text.slice(0, 8000)); } catch { /* Keep the original error. */ }
  }
  process.exitCode = 1;
} finally {
  if (context) { try { await context.tracing.stop({ path: path.join(artifacts, 'browser-trace.zip') }); } catch { /* No trace exists before login. */ } await context.close(); }
  if (browser) await browser.close();
  if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already stopped. */ } await sleep(800); try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already stopped. */ } }
  await writeFile(path.join(artifacts, 'browser-result.json'), JSON.stringify(report, null, 2));
  console.log('APP_BROWSER_RESULT', JSON.stringify(report));
  await rm(isolated, { recursive: true, force: true });
}
