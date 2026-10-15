import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createHarness as createAgentsHarness,
  claim,
  type Harness as AgentsHarness,
} from '../../app-plugin-agents/tests/harness.js';
import {
  createHarness as createProjectsHarness,
  type Harness as ProjectsHarness,
} from '../../app-plugin-projects/tests/harness.js';
import type { Viewer } from '@nocobase/app-plugin-projects/server/tokens';
import { ProjectReports } from '../server/service.js';
import { reportBinding, reportMount } from '../server/runtime.js';
import { RunnerFacts, Summary, type ReportView } from '../shared/api.js';
import { ATTEMPTS, REPORTS } from '../server/store.js';

let agents: AgentsHarness;
let projects: ProjectsHarness;
let reports: ProjectReports;
let viewer: Viewer;
let projectId: string;
let agentId: string;
let allowed = true;
const day = '2026-09-30';

beforeEach(async () => {
  agents = await createAgentsHarness();
  projects = await createProjectsHarness();
  await agents.database
    .createMigrator({
      directory: path.resolve(import.meta.dirname, '../database/migrations'),
      packageName: '@nocobase/app-plugin-project-reports',
    })
    .latest();
  await projects.addUser('owner');
  await projects.addUser('outsider');
  viewer = projects.viewer('owner', 'admin');
  const project = await projects.services.projects.create(viewer, {
    name: 'Report project',
    visibility: 'members',
    leadUserId: 'owner',
  });
  projectId = project.id;
  agentId = await agents.createAgent({
    source: 'runner',
    description: 'Report fixture',
    status: 'enabled',
  });
  allowed = true;
  reports = new ProjectReports({
    agents: agents.services,
    projects: projects.services,
    access: {
      permissionsOf: async () => viewer.permissions,
      admit: async () => {},
      changed: async () => {},
      administrators: async () => ['owner'],
      permissionsOfUser: async () =>
        allowed
          ? viewer.permissions
          : {
              ...viewer.permissions,
              scopes: {
                ...viewer.permissions.scopes,
                'pm.projects/manage': 'none',
              },
            },
    },
    onError: (message, error) => {
      throw new Error(`${message} ${String(error)}`);
    },
  });
  agents.services.subjects.register(reportBinding(reports));
  agents.services.mounts.register(
    reportMount(
      await readFile(
        path.resolve(import.meta.dirname, '../runner/collector.mjs'),
        'utf8',
      ),
    ),
  );
  await reports.saveSettings(viewer, projectId, {
    enabled: true,
    agentId,
    timezone: 'UTC',
    hour: 0,
    locale: 'en',
    expectedRevision: 0,
  });
});
afterEach(async () => {
  await agents?.close();
  await projects?.close();
});

async function active(): Promise<ReportView> {
  await agents.registerRunner({
    features: [
      'workspaceKey',
      'input',
      'checkout',
      'directories',
      'attachments',
      'skills',
      'secrets',
      'mounts',
    ],
  });
  const report = await reports.request(viewer, projectId, day);
  expect(report.runId).not.toBeNull();
  return report;
}
function facts(report: ReportView): RunnerFacts {
  return RunnerFacts.parse({
    version: 1,
    attemptId: report.currentAttemptId,
    repositories: [],
  });
}
const summary = (): Summary =>
  Summary.parse({
    overview: 'No repository changes were recorded for this non-code project.',
    items: [],
    minorFixes: '',
  });

describe('persisted project reports with real Projects and Agents services', () => {
  it('uses idempotent day keys and does not fabricate an issue', async () => {
    const first = await reports.request(viewer, projectId, day);
    const second = await reports.request(viewer, projectId, day);
    expect(second.id).toBe(first.id);
    expect(
      await agents.database
        .connection()
        .query.selectFrom(REPORTS)
        .selectAll()
        .execute(),
    ).toHaveLength(1);
    expect(
      await projects.database
        .connection()
        .query.selectFrom('pmIssues')
        .selectAll()
        .execute(),
    ).toHaveLength(0);
  });
  it('claims a report on the normal runner protocol with an isolated read-only workspace', async () => {
    const runner = await agents.registerRunner({
      features: [
        'workspaceKey',
        'input',
        'checkout',
        'directories',
        'attachments',
        'skills',
        'secrets',
        'mounts',
      ],
    });
    const report = await reports.request(viewer, projectId, day);
    const payloads: unknown[] = await claim(agents, runner);
    expect(payloads).toHaveLength(1);
    const serialized = JSON.stringify(payloads);
    expect(serialized).toContain(report.currentAttemptId);
    expect(serialized).toContain('project-report-tools');
    expect(serialized).toContain('"readOnly":true');
  });
  it('stores facts before a summary and retains a published report after failed regeneration', async () => {
    const first = await active();
    await reports.acceptFacts(
      first.runId!,
      first.currentAttemptId,
      'owner',
      facts(first),
    );
    expect((await reports.get(viewer, first.id)).facts).not.toBeNull();
    await reports.publish(
      first.runId!,
      first.currentAttemptId,
      'owner',
      summary(),
    );
    await reports.cancel(viewer, first.id);
    const published = await reports.get(viewer, first.id);
    expect(published.status).toBe('ready');
    const next = await reports.request(
      viewer,
      projectId,
      day,
      true,
      published.revision,
    );
    expect(next.currentAttemptId).not.toBe(first.currentAttemptId);
    await expect(
      reports.publish(first.runId!, first.currentAttemptId, 'owner', summary()),
    ).rejects.toThrow();
    await reports.cancel(viewer, next.id);
    const failed = await reports.get(viewer, next.id);
    expect(failed.status).toBe('failed');
    expect(failed.publishedAttemptId).toBe(first.currentAttemptId);
    expect(failed.summary).toEqual(summary());
  });
  it('rejects a foreign run, missing facts and revoked owner permissions', async () => {
    const report = await active();
    await expect(
      reports.acceptFacts(
        'foreign',
        report.currentAttemptId,
        'owner',
        facts(report),
      ),
    ).rejects.toThrow();
    await expect(
      reports.publish(
        report.runId!,
        report.currentAttemptId,
        'owner',
        summary(),
      ),
    ).rejects.toThrow();
    allowed = false;
    await expect(
      reports.acceptFacts(
        report.runId!,
        report.currentAttemptId,
        'owner',
        facts(report),
      ),
    ).rejects.toThrow();
  });
  it('never serves a private project report to an unrelated member', async () => {
    const report = await reports.request(viewer, projectId, day);
    const outsider = projects.viewer('outsider');
    await expect(reports.get(outsider, report.id)).rejects.toThrow();
    expect(
      (await reports.list(outsider, { date: day, days: 7 })).reports,
    ).toEqual([]);
  });
  it('enforces settings revisions and rejects unfinished calendar days', async () => {
    await expect(
      reports.saveSettings(viewer, projectId, {
        enabled: true,
        agentId,
        timezone: 'UTC',
        hour: 1,
        locale: 'en',
        expectedRevision: 0,
      }),
    ).rejects.toThrow();
    await expect(
      reports.request(viewer, projectId, '2026-10-01'),
    ).rejects.toThrow();
  });
  it('does not dispatch more than two reports at once', async () => {
    await agents.registerRunner({
      slots: 8,
      features: [
        'workspaceKey',
        'input',
        'checkout',
        'directories',
        'attachments',
        'skills',
        'secrets',
        'mounts',
      ],
    });
    await reports.request(viewer, projectId, '2026-09-28');
    await reports.request(viewer, projectId, '2026-09-29');
    await reports.request(viewer, projectId, day);
    const activeRows = await agents.database
      .connection()
      .query.selectFrom(ATTEMPTS)
      .selectAll()
      .where('state', '=', 'active')
      .execute();
    expect(activeRows).toHaveLength(2);
  });
  it('serializes concurrent publication and preserves the first accepted summary', async () => {
    const report = await active();
    await reports.acceptFacts(
      report.runId!,
      report.currentAttemptId,
      'owner',
      facts(report),
    );
    const first = summary();
    const second = { ...first, overview: 'Another summary of the same day.' };
    const results = await Promise.allSettled([
      reports.publish(report.runId!, report.currentAttemptId, 'owner', first),
      reports.publish(report.runId!, report.currentAttemptId, 'owner', second),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect((await reports.get(viewer, report.id)).summary).not.toBeNull();
  });
});
