import {
  test,
  expect,
  open,
  unique,
  horizontalOverflow,
  apiAs,
} from './support/fixtures.ts';
import { FakeRunner } from './support/runner.ts';
import type {
  Material,
  ReportView,
  RunnerFacts,
} from '@nocobase/app-plugin-project-reports/shared/api';

test.use({ isolatedStudio: true });

test('project report settings, runner publication, history, permissions and responsive UI', async ({
  page,
  api,
  browser,
  studio,
}, testInfo) => {
  const name = `日报验证 ${unique()}`;
  const project = await api.post<{ id: string }>('projects', {
    name,
    visibility: 'members',
  });
  const repository = await api.post<{ id: string }>(
    `projects/${project.id}/resources`,
    {
      type: 'gitRepo',
      url: 'https://example.invalid/reports/fixture.git',
      defaultRef: 'main',
      label: 'Report fixture',
    },
  );
  const runner = new FakeRunner(api, `reports-${unique()}`, true, {
    mounts: true,
  });
  const agentId = await runner.agent();
  const date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await open(page, `/project-reports?project=${project.id}&date=${date}`);
  await expect(
    page.getByRole('heading', { name: '项目报告', exact: true }),
  ).toBeVisible();
  await page.getByText('报告设置', { exact: true }).click();
  await page.getByLabel('Runner Agent', { exact: true }).selectOption(agentId);
  await page.getByLabel('时区', { exact: true }).fill('UTC');
  await page.getByLabel('开始时间（本地小时）', { exact: true }).fill('23');
  await page.getByLabel('摘要语言', { exact: true }).selectOption('zh-CN');
  await page.getByLabel('每天自动生成', { exact: true }).check();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByText('设置已保存。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '生成报告', exact: true }).click();
  const list = () =>
    api.get<{ reports: ReportView[] }>(
      `project-reports?projectId=${project.id}&date=${date}&days=1`,
    );
  await expect.poll(async () => (await list()).reports.length).toBe(1);
  const report = (await list()).reports[0];
  const running = await runner.start(`report-${report.currentAttemptId}`);
  const headers = { 'x-nocobase-run-token': running.token };
  const current = await api.get<{ material: Material }>(
    'project-reports/current',
    headers,
  );
  expect(current.material.repositories).toEqual([
    {
      resourceId: repository.id,
      url: 'https://example.invalid/reports/fixture.git',
      ref: 'main',
    },
  ]);
  const delta = { added: 0, deleted: 0 };
  const sha = 'a'.repeat(40);
  // Protocol fixture only. The collector has separate real-Git tests; this does not contact a Git host or an LLM.
  const facts: RunnerFacts = {
    version: 1,
    attemptId: report.currentAttemptId,
    repositories: [
      {
        resourceId: repository.id,
        status: 'ok',
        baseSha: 'b'.repeat(40),
        headSha: sha,
        boundary: 'commit-time-estimate',
        code: {
          source: { added: 120, deleted: 35 },
          tests: { added: 24, deleted: 3 },
          documentation: delta,
          configuration: delta,
          generated: delta,
          files: 4,
          binaryFiles: 0,
        },
        tests: {
          method: 'inventory',
          added: 3,
          deleted: 1,
          before: 10,
          after: 12,
        },
        commits: [{ sha, title: 'feat: add project progress reporting' }],
        commitCount: 1,
        warnings: ['commit-time-boundaries-not-push-times'],
        truncated: false,
      },
    ],
  };
  await api.post('project-reports/current/facts', facts, headers);
  await api.post(
    'project-reports/current/publish',
    {
      overview: '新增每日项目进展报告，支持按项目阅读功能变化并查看历史趋势。',
      items: [
        {
          category: 'feature',
          title: '新增结构化项目日报',
          description: '汇总关键功能和架构调整，并可展开查看真实来源。',
          stage: 'on-target-branch',
          evidence: [`git:${repository.id}:${sha}`],
        },
      ],
      minorFixes: '优化空状态和错误提示。',
    },
    headers,
  );
  await runner.complete(running.runId, 'Report published.');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '新增结构化项目日报', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('+120', { exact: true })).toBeVisible();
  await expect(page.getByText('−35', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '变更趋势', exact: true }),
  ).toBeVisible();
  await page.getByText('查看趋势数据', { exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '新增结构化项目日报', exact: true }),
  ).toBeVisible();
  await expect.poll(() => horizontalOverflow(page)).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath('project-reports-desktop.png'),
    fullPage: true,
  });
  await page.evaluate("document.documentElement.classList.add('dark')");
  await page.screenshot({
    path: testInfo.outputPath('project-reports-dark.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => horizontalOverflow(page)).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath('project-reports-phone.png'),
    fullPage: true,
  });
  const outsider = await apiAs(browser, 'lisa', studio);
  await expect(
    outsider.api.get(`project-reports/${report.id}`),
  ).rejects.toThrow();
  await outsider.close();
  // A report run is not an issue, so report generation cannot inflate task counts.
  expect((await list()).reports[0].material.issues.created).toBe(0);
});
