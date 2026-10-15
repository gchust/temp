import { randomUUID } from 'node:crypto';
import type { Agents, Tx } from '@nocobase/app-plugin-agents/server/tokens';
import type { Run } from '@nocobase/app-plugin-agents/shared/runs';
import type { Projects, ProjectsAccess, Viewer } from '@nocobase/app-plugin-projects/server/tokens';
import type { ProjectDetail, ProjectListItem } from '@nocobase/app-plugin-projects/shared/projects';
import type { DatabaseConnection } from '@nocobase/db';

import {
  SUBJECT, REPORTER, Material, RunnerFacts, Summary, SettingsInput, defaultSettings,
  validateFacts, validateSummary, type Settings, type ReportView, type ReportPageData,
} from '../shared/api.js';
import { addDays, dayAt, dayWindow, localHour } from '../shared/dates.js';
import { validRemote, validRef } from '../runner/collector.mjs';
import { reportError } from './errors.js';
import {
  SETTINGS, REPORTS, ATTEMPTS, LOCKS, getReport, getAttempt, attemptOf, settingsOf,
  text, nullableText, hash, isUniqueViolation, type Row, type Attempt,
} from './store.js';

export interface ReportDependencies {
  readonly agents: Agents;
  readonly projects: Projects;
  readonly access: ProjectsAccess;
  readonly onError: (message: string, error: unknown) => void;
}
const QUEUE_LIMIT = 2;
const MAX_WAIT_MS = 6 * 3600_000;

/** Project view and issue view can be granted over different sets of people. A shared report needs both. */
function issueViewer(viewer: Viewer): Viewer {
  return { ...viewer, permissions: { ...viewer.permissions, scopes: {
    ...viewer.permissions.scopes, 'pm.projects/view': viewer.permissions.scopes['pm.issues/view'],
  } } };
}
export function canManage(viewer: Viewer, project: Pick<ProjectDetail, 'leadUserId'>): boolean {
  const scope = viewer.permissions.scopes['pm.projects/manage'];
  return scope === 'all' || scope !== 'none' && project.leadUserId !== null && scope.users.includes(project.leadUserId);
}

export class ProjectReports {
  readonly deps: ReportDependencies;
  constructor(deps: ReportDependencies) { this.deps = deps; }
  connection(): DatabaseConnection { return this.deps.agents.tx.read(); }
  now(): Date { return this.deps.agents.clock.now(); }

  async viewerForUser(userId: string): Promise<Viewer> {
    if (!this.deps.access.permissionsOfUser || (await this.deps.agents.people.inactive(this.connection(), [userId])).has(userId))
      throw reportError('PERMISSION_DENIED', 'REPORT_OWNER_UNAVAILABLE', 'The report owner can no longer act.');
    return { userId, actor: { type: 'user', id: userId }, permissions: await this.deps.access.permissionsOfUser(userId) };
  }

  async readableProject(viewer: Viewer, id: string, manage = false): Promise<ProjectDetail> {
    const project = await this.deps.projects.projects.get(viewer, id);
    await this.deps.projects.projects.get(issueViewer(viewer), id);
    if (manage && !canManage(viewer, project)) throw reportError('PERMISSION_DENIED', 'REPORT_MANAGE_FORBIDDEN', 'Manage this project to configure or generate its reports.');
    return project;
  }

  async readableProjects(viewer: Viewer): Promise<ProjectListItem[]> {
    const [projects, issues] = await Promise.all([
      this.deps.projects.projects.list(viewer), this.deps.projects.projects.list(issueViewer(viewer)),
    ]);
    const ids = new Set(issues.map((project) => project.id));
    return projects.filter((project) => ids.has(project.id));
  }

  async options(viewer: Viewer): Promise<ReportPageData> {
    const projects = await this.readableProjects(viewer);
    const choices = projects.some((project) => canManage(viewer, project)) ? await this.deps.agents.roster(this.connection(), viewer.userId) : [];
    return { projects: projects.map((project) => ({ id: project.id, name: project.name, canManage: canManage(viewer, project) })), agents: choices.map((agent) => ({ id: agent.id, name: agent.name })) };
  }

  async readSettings(projectId: string, actorUserId: string): Promise<Settings> {
    const row = await this.connection().query.selectFrom(SETTINGS).selectAll().where('projectId', '=', projectId).executeTakeFirst();
    return row ? settingsOf(row) : { ...defaultSettings(), projectId, actorUserId, revision: 0 };
  }

  async settings(viewer: Viewer, projectId: string): Promise<Settings> {
    await this.readableProject(viewer, projectId);
    return this.readSettings(projectId, viewer.userId);
  }

  async saveSettings(viewer: Viewer, projectId: string, input: SettingsInput): Promise<Settings> {
    await this.readableProject(viewer, projectId, true);
    const { expectedRevision, ...config } = SettingsInput.parse(input);
    if (config.enabled && !config.agentId) throw reportError('INVALID_ARGUMENT', 'REPORT_AGENT_REQUIRED', 'Choose a runner agent before enabling reports.');
    if (config.agentId) await this.requireAgent(config.agentId);
    const previous = await this.readSettings(projectId, viewer.userId);
    if (previous.revision !== expectedRevision) throw reportError('ABORTED', 'REPORT_SETTINGS_CHANGED', 'Report settings changed. Reload them before saving.');
    await this.deps.agents.tx.run(async ({ conn }) => {
      if (expectedRevision === 0) {
        try { await conn.query.insertInto(SETTINGS).values({ projectId, actorUserId: viewer.userId, config: JSON.stringify(config), revision: 1 }).execute(); }
        catch (error) { if (!isUniqueViolation(error)) throw error; throw reportError('ABORTED', 'REPORT_SETTINGS_CHANGED', 'Report settings changed. Reload them before saving.'); }
      } else {
        const result = await conn.query.updateTable(SETTINGS).set({ actorUserId: viewer.userId, config: JSON.stringify(config), revision: expectedRevision + 1 }).where('projectId', '=', projectId).where('revision', '=', expectedRevision).executeTakeFirst();
        if (Number(result.numUpdatedRows) !== 1) throw reportError('ABORTED', 'REPORT_SETTINGS_CHANGED', 'Report settings changed. Reload them before saving.');
      }
    });
    return this.readSettings(projectId, viewer.userId);
  }

  async requireAgent(id: string) {
    const agent = await this.deps.agents.agents.find(this.connection(), id);
    if (!agent || agent.source !== 'runner' || agent.status !== 'enabled') throw reportError('FAILED_PRECONDITION', 'REPORT_AGENT_UNAVAILABLE', 'Choose an enabled runner agent.');
    return agent;
  }

  async request(viewer: Viewer, projectId: string, day: string, retry = false, expectedRevision?: number): Promise<ReportView> {
    const project = await this.readableProject(viewer, projectId, true);
    const settings = await this.readSettings(projectId, viewer.userId);
    if (!settings.agentId) throw reportError('FAILED_PRECONDITION', 'REPORT_AGENT_REQUIRED', 'Configure a runner agent for this project first.');
    await this.requireAgent(settings.agentId);
    const window = dayWindow(day, settings.timezone);
    if (Date.parse(window.to) > this.now().getTime()) throw reportError('INVALID_ARGUMENT', 'REPORT_DAY_INCOMPLETE', 'Generate a report for a complete calendar day.');
    const existing = await this.connection().query.selectFrom(REPORTS).selectAll().where('projectId', '=', projectId).where('day', '=', day).where('timezone', '=', settings.timezone).executeTakeFirst();
    if (existing) {
      const current = await getAttempt(this.connection(), text(existing.currentAttemptId));
      if (!retry || current?.state === 'queued' || current?.state === 'active') return this.view(existing);
      if (expectedRevision !== Number(existing.revision)) throw reportError('ABORTED', 'REPORT_CHANGED', 'The report changed. Reload it before regenerating.');
    }
    const reportId = existing ? text(existing.id) : randomUUID();
    const attemptId = randomUUID();
    const distinct = new Map<string, Material['repositories'][number]>();
    for (const resource of project.resources) {
      if (resource.type !== 'gitRepo' || !resource.url) continue;
      if (!validRemote(resource.url) || !validRef(resource.defaultRef)) throw reportError('INVALID_ARGUMENT', 'REPORT_REPOSITORY_INVALID', 'Use an HTTPS or SSH repository URL without embedded credentials and a valid ref.');
      distinct.set(JSON.stringify([resource.url, resource.defaultRef]), { resourceId: resource.id, url: resource.url, ref: resource.defaultRef });
    }
    const issues = await this.deps.projects.reports.daily(viewer, { projectId, from: new Date(window.from), to: new Date(window.to) });
    const prior = await this.connection().query.selectFrom(REPORTS).selectAll().where('projectId', '=', projectId).where('day', '=', addDays(day, -1)).where('timezone', '=', settings.timezone).executeTakeFirst();
    const published = prior?.publishedAttemptId ? await getAttempt(this.connection(), text(prior.publishedAttemptId)) : null;
    const previous: Material['previous'] = published?.facts?.repositories.flatMap((facts) => {
      const spec = published.material.repositories.find((repository) => repository.resourceId === facts.resourceId);
      return spec && facts.status === 'ok' ? [{ ...spec, to: published.material.to, headSha: facts.headSha }] : [];
    }) ?? [];
    const material = Material.parse({ version: 1, reportId, attemptId, projectId, projectName: project.name, date: day, timezone: settings.timezone, ...window, locale: settings.locale, repositories: [...distinct.values()], issues, previous });
    const at = this.now();
    try {
      await this.deps.agents.tx.run(async ({ conn }) => {
        if (existing) {
          const result = await conn.query.updateTable(REPORTS).set({ currentAttemptId: attemptId, revision: Number(existing.revision) + 1, updatedAt: at }).where('id', '=', reportId).where('revision', '=', Number(existing.revision)).executeTakeFirst();
          if (Number(result.numUpdatedRows) !== 1) throw reportError('ABORTED', 'REPORT_CHANGED', 'The report changed. Reload it before regenerating.');
        } else {
          await conn.query.insertInto(REPORTS).values({ id: reportId, projectId, day, timezone: settings.timezone, currentAttemptId: attemptId, publishedAttemptId: null, revision: 1, createdAt: at, updatedAt: at }).execute();
        }
        await conn.query.insertInto(ATTEMPTS).values({ id: attemptId, reportId, actorUserId: viewer.userId, agentId: settings.agentId, runId: null, state: 'queued', material: JSON.stringify(material), facts: null, factsHash: null, summary: null, error: null, createdAt: at, finishedAt: null }).execute();
      });
    } catch (error) {
      if (!existing && isUniqueViolation(error)) {
        const winner = await this.connection().query.selectFrom(REPORTS).selectAll().where('projectId', '=', projectId).where('day', '=', day).where('timezone', '=', settings.timezone).executeTakeFirst();
        if (winner) return this.view(winner);
      }
      throw error;
    }
    // Best-effort dispatch is not generation: an unavailable runner leaves a visible queue entry for the scheduler.
    await this.dispatch().catch((error: unknown) => this.deps.onError('Project report dispatch failed.', error));
    return this.get(viewer, reportId);
  }

  async get(viewer: Viewer, id: string): Promise<ReportView> {
    const report = await getReport(this.connection(), id);
    if (!report) throw reportError('NOT_FOUND', 'REPORT_NOT_FOUND', 'The report does not exist.');
    await this.readableProject(viewer, text(report.projectId));
    return this.view(report);
  }

  private fromRows(row: Row, attempts: ReadonlyMap<string, Attempt>): ReportView {
    const current = attempts.get(text(row.currentAttemptId));
    if (!current) throw new Error('The current report attempt is missing.');
    const published = attempts.get(text(row.publishedAttemptId));
    const shown = published ?? current;
    const partial = shown.facts?.repositories.some((repository) => repository.status !== 'ok' || repository.truncated || repository.tests === null) || shown.material.issues.truncated;
    return {
      id: text(row.id), projectId: text(row.projectId), projectName: shown.material.projectName, date: text(row.day), timezone: text(row.timezone),
      status: current.summary ? partial ? 'partial' : 'ready' : current.state === 'failed' ? 'failed' : 'generating',
      currentAttemptId: current.id, publishedAttemptId: nullableText(row.publishedAttemptId), runId: current.runId,
      error: current.error, generatedAt: shown.finishedAt, material: shown.material, facts: shown.facts, summary: shown.summary, revision: Number(row.revision),
    };
  }

  private async view(row: Row): Promise<ReportView> {
    const ids = [...new Set([text(row.currentAttemptId), text(row.publishedAttemptId)].filter(Boolean))];
    const entries = await this.connection().query.selectFrom(ATTEMPTS).selectAll().where('id', 'in', ids).execute();
    return this.fromRows(row, new Map(entries.map((entry) => { const attempt = attemptOf(entry); return [attempt.id, attempt]; })));
  }

  async list(viewer: Viewer, query: { date: string; days: number; projectId?: string }): Promise<{ reports: ReportView[]; truncated: boolean }> {
    let projects = await this.readableProjects(viewer);
    if (query.projectId) {
      projects = projects.filter((project) => project.id === query.projectId);
      if (!projects.length) throw reportError('NOT_FOUND', 'REPORT_PROJECT_NOT_FOUND', 'The project is not available.');
    }
    if (!projects.length) return { reports: [], truncated: false };
    const rows = await this.connection().query.selectFrom(REPORTS).selectAll().where('projectId', 'in', projects.map((project) => project.id)).where('day', '>=', addDays(query.date, 1 - query.days)).where('day', '<=', query.date).orderBy('day', 'desc').orderBy('projectId', 'asc').limit(5001).execute();
    const visible = rows.slice(0, 5000);
    const ids = [...new Set(visible.flatMap((row) => [text(row.currentAttemptId), text(row.publishedAttemptId)]).filter(Boolean))];
    const attempts = new Map<string, Attempt>();
    for (let index = 0; index < ids.length; index += 400) {
      for (const row of await this.connection().query.selectFrom(ATTEMPTS).selectAll().where('id', 'in', ids.slice(index, index + 400)).execute()) {
        const attempt = attemptOf(row); attempts.set(attempt.id, attempt);
      }
    }
    return { reports: visible.map((row) => this.fromRows(row, attempts)), truncated: rows.length > visible.length };
  }

  /** Rechecked before a claim and before accepting output. Revoked project access never becomes a report capability. */
  async mayRun(attempt: Attempt): Promise<boolean> {
    try { await this.readableProject(await this.viewerForUser(attempt.actorUserId), attempt.material.projectId, true); await this.requireAgent(attempt.agentId); return true; }
    catch { return false; }
  }

  async current(runId: string, attemptId: string, actorUserId: string): Promise<Attempt> {
    const attempt = await getAttempt(this.connection(), attemptId);
    if (!attempt || attempt.runId !== runId || attempt.actorUserId !== actorUserId || attempt.state !== 'active') throw reportError('PERMISSION_DENIED', 'REPORT_RUN_FORBIDDEN', 'This run does not own an active report attempt.');
    const row = await getReport(this.connection(), attempt.reportId);
    if (row?.currentAttemptId !== attempt.id || !await this.mayRun(attempt)) throw reportError('PERMISSION_DENIED', 'REPORT_RUN_STALE', 'This report attempt is no longer authorized.');
    return attempt;
  }

  async acceptFacts(runId: string, attemptId: string, actorUserId: string, value: RunnerFacts): Promise<void> {
    const before = await this.current(runId, attemptId, actorUserId);
    const facts = RunnerFacts.parse(value);
    try { validateFacts(before.material, facts); }
    catch (error) { throw reportError('INVALID_ARGUMENT', 'REPORT_FACTS_INVALID', error instanceof Error ? error.message : 'Invalid report facts.'); }
    await this.deps.agents.tx.run(async ({ conn }) => {
      const attempt = await getAttempt(conn, attemptId);
      const row = await getReport(conn, before.reportId);
      if (!attempt || attempt.state !== 'active' || attempt.runId !== runId || row?.currentAttemptId !== attempt.id) throw reportError('ABORTED', 'REPORT_RUN_STALE', 'This report attempt is no longer current.');
      if (attempt.facts) {
        if (hash(attempt.facts) !== hash(facts)) throw reportError('ALREADY_EXISTS', 'REPORT_FACTS_IMMUTABLE', 'Facts were already accepted and cannot be replaced.');
        return;
      }
      await conn.query.updateTable(ATTEMPTS).set({ facts: JSON.stringify(facts), factsHash: hash(facts) }).where('id', '=', attemptId).where('factsHash', 'is', null).execute();
    });
  }

  async publish(runId: string, attemptId: string, actorUserId: string, value: Summary): Promise<void> {
    const before = await this.current(runId, attemptId, actorUserId);
    if (!before.facts) throw reportError('FAILED_PRECONDITION', 'REPORT_FACTS_REQUIRED', 'Submit deterministic collection facts before the summary.');
    const summary = Summary.parse(value);
    try { validateSummary(before.material, before.facts, summary); }
    catch (error) { throw reportError('INVALID_ARGUMENT', 'REPORT_SUMMARY_INVALID', error instanceof Error ? error.message : 'Invalid report summary.'); }
    await this.deps.agents.tx.run(async ({ conn }) => {
      const attempt = await getAttempt(conn, attemptId);
      if (!attempt || attempt.state !== 'active' || attempt.runId !== runId) throw reportError('ABORTED', 'REPORT_RUN_STALE', 'This report attempt is no longer active.');
      if (attempt.summary && hash(attempt.summary) !== hash(summary)) throw reportError('ALREADY_EXISTS', 'REPORT_SUMMARY_IMMUTABLE', 'Regenerate the report to change an accepted summary.');
      const result = await conn.query.updateTable(REPORTS).set({ publishedAttemptId: attemptId, updatedAt: this.now() }).where('id', '=', before.reportId).where('currentAttemptId', '=', attemptId).executeTakeFirst();
      if (Number(result.numUpdatedRows) !== 1) throw reportError('ABORTED', 'REPORT_RUN_STALE', 'A newer report attempt exists.');
      await conn.query.updateTable(ATTEMPTS).set({ summary: JSON.stringify(summary), finishedAt: this.now(), error: null }).where('id', '=', attemptId).execute();
    });
  }

  async finished(tx: Tx, run: Run): Promise<void> {
    const attempt = await getAttempt(tx.conn, run.subject.id);
    if (!attempt || attempt.runId !== run.id || attempt.state !== 'active') return;
    const valid = attempt.summary !== null && attempt.facts !== null;
    await tx.conn.query.updateTable(ATTEMPTS).set({ state: valid ? 'complete' : 'failed', finishedAt: this.now(), error: valid ? null : run.status === 'completed' ? 'The runner ended without submitting a validated summary.' : 'The report run failed or was cancelled. Its previous published result is retained.' }).where('id', '=', attempt.id).execute();
  }

  async cancel(viewer: Viewer, reportId: string): Promise<void> {
    const report = await this.get(viewer, reportId);
    await this.readableProject(viewer, report.projectId, true);
    if (report.runId) await this.deps.agents.runs.cancel(report.runId, viewer.userId);
    else await this.connection().query.updateTable(ATTEMPTS).set({ state: 'failed', finishedAt: this.now(), error: 'Report generation was cancelled.' }).where('id', '=', report.currentAttemptId).where('state', '=', 'queued').execute();
  }

  private async lockRow(): Promise<void> {
    const conn = this.connection();
    const row = await conn.query.selectFrom(LOCKS).select('id').where('id', '=', 'dispatch').executeTakeFirst();
    if (row) return;
    try { await conn.query.insertInto(LOCKS).values({ id: 'dispatch', nonce: randomUUID() }).execute(); }
    catch (error) { if (!isUniqueViolation(error)) throw error; }
  }

  async dispatch(): Promise<number> {
    await this.lockRow();
    const rows = await this.connection().query.selectFrom(ATTEMPTS).selectAll().where('state', '=', 'queued').orderBy('createdAt', 'asc').limit(30).execute();
    let started = 0;
    for (const row of rows) {
      const attempt = attemptOf(row);
      if (!await this.mayRun(attempt) || this.now().getTime() - Date.parse(attempt.createdAt) > MAX_WAIT_MS) {
        await this.connection().query.updateTable(ATTEMPTS).set({ state: 'failed', finishedAt: this.now(), error: 'The report owner or agent is unavailable, or no compatible runner became available within six hours.' }).where('id', '=', attempt.id).where('state', '=', 'queued').execute();
        continue;
      }
      const roster = await this.deps.agents.roster(this.connection(), attempt.actorUserId);
      if (!roster.some((agent) => agent.id === attempt.agentId && agent.online)) continue;
      const source = await this.requireAgent(attempt.agentId);
      const agent = await this.deps.agents.agents.ensureSystem({
        id: `${REPORTER}-${hash(attempt.agentId).slice(0, 20)}`, name: 'Project report writer', description: 'Read project changes and return a structured daily report.',
        instructions: 'Only analyze the supplied report material. Do not change code, issues, projects or deployments.', actions: [], modelEntries: source.modelEntries,
      }, attempt.actorUserId);
      const enqueued = await this.deps.agents.tx.run(async (tx) => {
        // A database row serializes dispatch across processes; the scheduler occurrence id alone is not sufficient.
        await tx.conn.query.updateTable(LOCKS).set({ nonce: randomUUID() }).where('id', '=', 'dispatch').execute();
        const active = await tx.conn.query.selectFrom(ATTEMPTS).select('id').where('state', '=', 'active').limit(QUEUE_LIMIT).execute();
        if (active.length >= QUEUE_LIMIT) return false;
        const current = await getAttempt(tx.conn, attempt.id);
        if (!current || current.state !== 'queued') return false;
        const run = await this.deps.agents.runs.enqueue({
          agentId: agent.id, subject: { kind: SUBJECT, id: attempt.id }, actorUserId: attempt.actorUserId, ownerUserId: attempt.actorUserId,
          priority: 100, maxAttempts: 1, requires: ['mounts'], freshSession: true,
          input: { type: 'signal', actor: { type: 'user', id: attempt.actorUserId }, text: 'Generate this project daily report.' },
        }, tx);
        if (!run.runId) throw new Error('Report dispatch unexpectedly requires approval.');
        await tx.conn.query.updateTable(ATTEMPTS).set({ state: 'active', runId: run.runId }).where('id', '=', attempt.id).where('state', '=', 'queued').execute();
        return true;
      });
      if (enqueued) started++;
      else break;
    }
    return started;
  }

  async tick(): Promise<{ requested: number; started: number }> {
    const configs = (await this.connection().query.selectFrom(SETTINGS).selectAll().execute()).map(settingsOf).filter((config) => config.enabled && config.agentId);
    let requested = 0;
    for (const config of configs) {
      const day = addDays(dayAt(this.now(), config.timezone), -1);
      if (localHour(this.now(), config.timezone) < config.hour) continue;
      const exists = await this.connection().query.selectFrom(REPORTS).select('id').where('projectId', '=', config.projectId).where('day', '=', day).where('timezone', '=', config.timezone).executeTakeFirst();
      if (exists) continue;
      try { await this.request(await this.viewerForUser(config.actorUserId), config.projectId, day); requested++; }
      catch (error) { this.deps.onError('A project daily report could not be requested.', error); }
    }
    return { requested, started: await this.dispatch() };
  }
}
