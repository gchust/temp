import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] ?? 'source');
async function edit(path, change) { const file = resolve(root, path); const old = await readFile(file, 'utf8'); const next = change(old); if (old === next) throw new Error(`No edit in ${path}`); await writeFile(file, next); }
const plugin = 'packages/plugins/app-plugin-project-reports/';
await edit(plugin + 'server/store.ts', (text) => text
  .replace('Material, RunnerFacts, Summary, type Settings', 'Material, RunnerFacts, Summary, SettingsInput, type Settings')
  .replace("...(config as Omit<Settings, 'projectId' | 'actorUserId' | 'revision'>)", '...SettingsInput.omit({ expectedRevision: true }).parse(config)')
  + `\n/** A portable write lock, also on SQLite where SELECT FOR UPDATE is not available. */
export async function lockAttempt(conn: DatabaseConnection, id: string): Promise<Attempt | null> {
  await conn.query.updateTable(ATTEMPTS).set({ id }).where('id', '=', id).execute();
  return getAttempt(conn, id);
}
`);
await edit(plugin + 'server/service.ts', (text) => text
  .replace('getReport, getAttempt, attemptOf, settingsOf,', 'getReport, getAttempt, lockAttempt, attemptOf, settingsOf,')
  .replaceAll('const attempt = await getAttempt(conn, attemptId);', 'const attempt = await lockAttempt(conn, attemptId);')
  .replace('const attempt = await getAttempt(tx.conn, run.subject.id);', 'const attempt = await lockAttempt(tx.conn, run.subject.id);')
  .replace("if (attempt.summary && hash(attempt.summary) !== hash(summary)) throw reportError('ALREADY_EXISTS', 'REPORT_SUMMARY_IMMUTABLE', 'Regenerate the report to change an accepted summary.');", "if (attempt.summary) {\n        if (hash(attempt.summary) !== hash(summary)) throw reportError('ALREADY_EXISTS', 'REPORT_SUMMARY_IMMUTABLE', 'Regenerate the report to change an accepted summary.');\n        return;\n      }")
  .replace("const rows = await this.connection().query.selectFrom(REPORTS).selectAll().where('projectId', 'in', projects.map((project) => project.id))", "const rows = await this.connection().query.selectFrom(REPORTS).selectAll().where('projectId', 'in', projects.map((project) => project.id))")
);
await edit(plugin + 'shared/api.ts', (text) => text
  .replace("if (value.commits.length > value.commitCount)", "if (value.status === 'failed' && (value.commitCount !== 0 || value.commits.length !== 0 || value.baseSha !== null || value.headSha !== null)) context.addIssue({ code: 'custom', message: 'Failed collection cannot assert commit facts.' });\n  if (new Set(value.commits.map((commit) => commit.sha)).size !== value.commits.length) context.addIssue({ code: 'custom', message: 'Commit evidence must be unique.' });\n  if (value.commits.length > value.commitCount)")
  .replace("if (actual.size !== facts.repositories.length", "for (const repository of facts.repositories) {\n    if (repository.status === 'ok' && repository.boundary === 'previous-snapshot') {\n      const spec = material.repositories.find((item) => item.resourceId === repository.resourceId);\n      const previous = material.previous.find((item) => item.resourceId === repository.resourceId && item.url === spec?.url && item.ref === spec?.ref && item.to === material.from);\n      if (!previous || previous.headSha !== repository.baseSha) throw new Error('The result does not use the saved previous snapshot.');\n    }\n  }\n  if (actual.size !== facts.repositories.length")
);
