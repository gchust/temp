import { createHash } from 'node:crypto';
import type { DatabaseConnection } from '@nocobase/db';
import { Material, RunnerFacts, Summary, type Settings } from '../shared/api.js';

export const SETTINGS = 'projectReportSettings';
export const REPORTS = 'projectDailyReports';
export const ATTEMPTS = 'projectReportAttempts';
export const LOCKS = 'projectReportLocks';
export type Row = Record<string, unknown>;
export const text = (value: unknown): string => typeof value === 'string' ? value : '';
export const nullableText = (value: unknown): string | null => typeof value === 'string' ? value : null;
export const json = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) as unknown : value;
export const iso = (value: unknown): string | null => value instanceof Date ? value.toISOString() : typeof value === 'string' ? new Date(value).toISOString() : null;
export const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code: unknown = 'code' in error ? error.code : undefined;
  return code === '23505' || typeof code === 'string' && /^SQLITE_CONSTRAINT(?:_UNIQUE|_PRIMARYKEY)?$/u.test(code) || /unique constraint|UNIQUE constraint failed|Duplicate entry/iu.test(error.message);
}

export interface Attempt {
  id: string; reportId: string; actorUserId: string; agentId: string; runId: string | null;
  state: 'queued' | 'active' | 'complete' | 'failed'; material: Material; facts: RunnerFacts | null;
  summary: Summary | null; error: string | null; createdAt: string; finishedAt: string | null;
}
export function attemptOf(row: Row): Attempt {
  const state = text(row.state);
  if (!['queued', 'active', 'complete', 'failed'].includes(state)) throw new Error('Invalid saved report attempt state.');
  return {
    id: text(row.id), reportId: text(row.reportId), actorUserId: text(row.actorUserId), agentId: text(row.agentId), runId: nullableText(row.runId),
    state: state as Attempt['state'], material: Material.parse(json(row.material)),
    facts: row.facts == null ? null : RunnerFacts.parse(json(row.facts)), summary: row.summary == null ? null : Summary.parse(json(row.summary)),
    error: nullableText(row.error), createdAt: iso(row.createdAt) ?? '', finishedAt: iso(row.finishedAt),
  };
}
export async function getAttempt(conn: DatabaseConnection, id: string): Promise<Attempt | null> {
  const row = await conn.query.selectFrom(ATTEMPTS).selectAll().where('id', '=', id).executeTakeFirst();
  return row ? attemptOf(row) : null;
}
export async function getReport(conn: DatabaseConnection, id: string): Promise<Row | null> {
  return await conn.query.selectFrom(REPORTS).selectAll().where('id', '=', id).executeTakeFirst() ?? null;
}
export function settingsOf(row: Row): Settings {
  const config = json(row.config);
  if (!config || typeof config !== 'object') throw new Error('Invalid saved report settings.');
  return { ...(config as Omit<Settings, 'projectId' | 'actorUserId' | 'revision'>), projectId: text(row.projectId), actorUserId: text(row.actorUserId), revision: Number(row.revision) };
}
