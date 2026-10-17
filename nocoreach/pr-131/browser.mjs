import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Disposable GitHub Actions app. All credentials and storage are generated for
// this run; browser display fixtures do not exercise external Collector calls.
const root = path.resolve(process.argv[2]);
const artifacts = path.resolve(process.argv[3]);
const require = createRequire(path.join(root, 'package.json'));
const { chromium, expect } = require('@playwright/test');
const catalogs = Object.fromEntries(await Promise.all(['en', 'zh'].map(async (locale) => [
  locale, JSON.parse(await readFile(path.join(root, 'shared/i18n', locale + '.json'), 'utf8')),
])));
const isolated = await mkdtemp(path.join(tmpdir(), 'nocoreach-pr131-browser-'));
await mkdir(artifacts, { recursive: true });
const username = 'pr131qa';
const password = randomBytes(24).toString('base64url');
const secretsKey = '1:' + randomBytes(32).toString('hex');
const origin = 'http://127.0.0.1:13000';
const config = path.join(isolated, 'config.yml');
await writeFile(config, await readFile(path.join(root, 'config.example.yml'), 'utf8')
  + '\ni18n:\n  defaultLocale: en-US\nnocoreachMock:\n  enabled: true\n  environment: test\n  initializeData: true\njobs:\n  default: memory\n');
const report = { scope: 'Real isolated mock app, native keyboard focus and synthetic Collector display responses; no external Collector validation.', checks: [], pageErrors: [] };
const record = (name, details = {}) => {
  report.checks.push({ name, passed: true, ...details });
  console.log('PR131_BROWSER_PASS', name, JSON.stringify(details));
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child, browser, context, page;
let logs = '';
let display = null;

function fixture(platform, kind) {
  const project = kind === 'project';
  const collectors = project
    ? [{ id: `project-${platform}-1`, name: '项目采集器', nameKey: 'collectorConnection.projectSource' }]
    : [{ id: `project-${platform}-team`, name: '团队浏览器 / Custom team' }, { id: 'backup-browser', name: '备用浏览器 / Backup team' }];
  const common = { connected: project, configured: true, collectors, collectorId: project ? collectors[0].id : null, verifiedAt: null, lastRun: null, total: 0 };
  return platform === 'xiaohongshu'
    ? { ...common, revision: 1, query: project ? 'Synthetic project query' : '', running: null, notes: [], latestIds: [] }
    : { ...common, revision: project ? '641664cf-f741-4e91-b9dd-854b88ed1570' : null, terms: project ? ['Synthetic project query'] : [], bvids: [], checking: false, requestId: null, recent: [] };
}

try {
  child = spawn('pnpm', ['dev'], {
    cwd: root, detached: true,
    env: {
      ...process.env, APP_CONFIG_FILE: config, APP_STORAGE_DIR: path.join(isolated, 'storage'),
      DB_FILENAME: path.join(isolated, 'database.sqlite'), APP_PUBLIC_ORIGIN: origin,
      INITIAL_ADMIN_USERNAME: username, INITIAL_ADMIN_EMAIL: 'pr131-qa@example.test',
      INITIAL_ADMIN_PASSWORD: password, SECRETS_KEYS: secretsKey,
      NODE_OPTIONS: '--max-old-space-size=6144',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (chunk) => {
    const text = String(chunk).replaceAll(password, '[synthetic-password]').replaceAll(secretsKey, '[synthetic-secrets-key]');
    logs += text;
    void appendFile(path.join(artifacts, 'application.log'), text);
  };
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  child.on('error', (error) => { logs += '\nSPAWN_ERROR ' + error.message; });
  let base;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Application exited (${child.exitCode}): ${logs.slice(-8000)}`);
    const match = logs.replace(/\u001b\[[0-9;]*m/g, '').match(/Local:\s*(https?:\/\/[^\s]+)/);
    if (match) {
      const printed = new URL(match[1]);
      assert.equal(printed.origin, origin, 'Keep the printed Local host for authentication');
      base = printed.href.replace(/\/$/, '');
      try {
        if ((await fetch(base + '/api/healthz', { signal: AbortSignal.timeout(2500) })).ok) break;
      } catch { /* The app is still starting. */ }
    }
    await sleep(500);
  }
  assert.ok(base, 'The application must print its Local URL');
  assert.equal((await fetch(base + '/api/healthz', { signal: AbortSignal.timeout(10_000) })).status, 200);
  record('disposable-application-health');
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/Username or email|用户名或邮箱/, { exact: true }).fill(username);
  await page.getByLabel(/Password|密码/, { exact: true }).fill(password);
  const login = page.waitForResponse((response) => response.url().includes('/api/auth/sign-in/'));
  await page.getByRole('button', { name: /^Sign in$|^登录$/ }).click();
  assert.equal((await login).status(), 200);
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  record('fresh-synthetic-admin-login');
  await page.goto(base + '/connections');
  await expect(page.getByTestId('mock-environment-indicator')).toBeVisible();

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const source of ['xiaohongshu', 'bilibili', 'youtube']) {
      const trigger = page.locator(`[data-source-trigger="${source}"]`);
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      if (source === 'xiaohongshu') await page.screenshot({ path: path.join(artifacts, `panel-${width}.png`), fullPage: true });
      await dialog.getByRole('button', { name: /^Close$|^关闭$/ }).click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      assert.equal(await trigger.evaluate((element) => element.tabIndex), 0, 'Closing must keep the card in the native Tab order');
      await page.keyboard.press('Tab');
      await expect(trigger).not.toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(trigger).toBeFocused();
      record('native-focus-and-tab-order', { source, width });
    }
  }

  // Only the two read responses below use synthetic fixtures. The surrounding
  // app, locale menu, source page, forms and browser controls are real.
  for (const [platform, suffix] of [['xiaohongshu', 'nrXiaohongshu/view'], ['bilibili', 'nrBilibili/status']]) {
    await page.route(`**/api/nocoreach/${suffix}`, async (route) => {
      if (display?.platform !== platform) return route.continue();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: fixture(platform, display.kind) }) });
    });
  }
  for (const locale of ['en', 'zh']) {
    display = null;
    await page.goto(base + '/connections');
    await page.getByRole('button', { name: /Open account menu|打开账户菜单/ }).click();
    await page.getByRole('menuitem', { name: /Language|语言/ }).hover();
    await page.getByRole('menuitemradio', { name: locale === 'en' ? 'English' : '中文', exact: true }).click();
    await page.mouse.move(200, 90);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    for (const platform of ['xiaohongshu', 'bilibili']) {
      display = { platform, kind: 'deployment' };
      await page.goto(base + '/connections?source=' + platform);
      const panel = page.locator(platform === 'xiaohongshu' ? '[data-xiaohongshu-connect]' : '[data-bilibili-connection]');
      const selector = platform === 'xiaohongshu' ? panel.getByRole('combobox') : panel.locator('#bili-collector');
      await expect(selector).toBeVisible();
      if (platform === 'xiaohongshu') {
        await expect(selector).toHaveValue('project-xiaohongshu-team');
        await expect(selector.locator('option[value="project-xiaohongshu-team"]')).toHaveText('团队浏览器 / Custom team');
        await selector.selectOption('backup-browser');
        await expect(selector).toHaveValue('backup-browser');
      } else {
        await expect(selector).toContainText('团队浏览器 / Custom team');
        await selector.click();
        await page.getByRole('option', { name: '备用浏览器 / Backup team', exact: true }).click();
        await expect(selector).toContainText('备用浏览器 / Backup team');
      }
      record('custom-prefix-collector-remains-selectable', { platform, locale });
      display = { platform, kind: 'project' };
      await page.reload();
      await expect(panel).toContainText(catalogs[locale]['collectorConnection.projectSource']);
      if (locale === 'en') await expect(panel).not.toContainText('项目采集器');
      await page.screenshot({ path: path.join(artifacts, `${platform}-project-${locale}.png`), fullPage: true });
      record('project-collector-name-uses-active-locale', { platform, locale });
    }
  }
  assert.deepEqual(report.pageErrors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.message : String(error);
  console.error('PR131_BROWSER_FAIL', report.error);
  console.error('APPLICATION_LOG_TAIL', logs.slice(-8000));
  if (page) {
    try { await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }); } catch { /* Preserve the original error. */ }
    try { await writeFile(path.join(artifacts, 'failure-dom.txt'), await page.locator('body').innerText()); } catch { /* Preserve the original error. */ }
  }
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  if (child?.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
    await sleep(800);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already stopped. */ }
  }
  await writeFile(path.join(artifacts, 'browser-result.json'), JSON.stringify(report, null, 2));
  console.log('PR131_BROWSER_RESULT', JSON.stringify(report));
  await rm(isolated, { recursive: true, force: true });
}
