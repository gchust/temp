import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] ?? 'source');
async function edit(path, change) { const file = resolve(root, path); const old = await readFile(file, 'utf8'); const next = change(old); if (old === next) throw new Error(`No edit in ${path}`); await writeFile(file, next); }
const plugin = 'packages/plugins/app-plugin-project-reports/';
await edit(plugin + 'client/api.ts', (text) => text.replace("method: 'PUT', body", "method: 'PUT', json: body").replace("method: 'POST', body:", "method: 'POST', json:"));
await edit(plugin + 'server/runtime.ts', (text) => text.replace('export function reportMount(service: ProjectReports, collector: string)', 'export function reportMount(collector: string)'));
await edit(plugin + 'server/provider.ts', (text) => text.replace('reportMount(service, collector)', 'reportMount(collector)'));
await edit(plugin + 'server/service.ts', (text) => text
  .replaceAll(".where('revision', '=', expectedRevision).executeTakeFirst()", ".where('revision', '=', expectedRevision).execute()")
  .replaceAll(".where('revision', '=', Number(existing.revision)).executeTakeFirst()", ".where('revision', '=', Number(existing.revision)).execute()")
  .replaceAll(".where('currentAttemptId', '=', attemptId).executeTakeFirst()", ".where('currentAttemptId', '=', attemptId).execute()")
  .replaceAll('result.numUpdatedRows', 'result.updatedCount')
  .replace("actor: { type: 'user', id: attempt.actorUserId }, text:", "actor: { kind: 'user', id: attempt.actorUserId, name: 'Report owner' }, text:")
);
await edit(plugin + 'client/page.tsx', (text) => text
  .replace("const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;", "const [defaultDate] = useState(() => addDays(dayAt(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone), -1));")
  .replace("addDays(dayAt(new Date(), browserZone), -1)", 'defaultDate')
  .replace('notices.map(({ report, item }, index)', 'notices.map(({ report, item })')
  .replace('key={`${report.id}:${index}`}', 'key={`${report.id}:${item.category}:${item.title}:${item.evidence.join()}`}')
);
await edit(plugin + 'client/report-card.tsx', (text) => text
  .replace('export const importance', 'const importance')
  .replace('items.map((item, index)', 'items.map((item)')
  .replace('key={`${item.category}:${index}`}', 'key={`${item.category}:${item.title}:${item.evidence.join()}`}')
);
const trendPath = resolve(root, plugin, 'client/trend.tsx');
const trend = await readFile(trendPath, 'utf8');
const start = trend.indexOf('export type Metric');
const end = trend.indexOf('export function Trend');
await writeFile(resolve(root, plugin, 'client/trend-data.ts'), "import { addDays } from '../shared/dates.js';\nimport { totals, type ReportView } from '../shared/api.js';\n" + trend.slice(start, end));
await writeFile(trendPath, trend.slice(0, start).replace("import { addDays } from '../shared/dates.js';\n", '').replace("import { totals, type ReportView }", "import { type ReportView }") + "import { trendPoints, paths, type Metric } from './trend-data.js';\n\n" + trend.slice(end));
await edit(plugin + 'tests/client/trend.test.tsx', (text) => text.replace("../../client/trend.js", "../../client/trend-data.js"));
await edit(plugin + 'runner/collector.mjs', (text) => "import process from 'node:process';\nimport { URL } from 'node:url';\n" + text.replace('/[\\s\\x00-\\x1f]/u.test(remote)', "/\\s/u.test(remote) || Array.from(remote).some((char) => char.charCodeAt(0) < 32)"));
await edit(plugin + 'tests/collector.test.mjs', (text) => "import process from 'node:process';\n// The standalone collector deliberately runs with Node alone, without installing project dependencies.\n// eslint-disable-next-line vitest/no-import-node-test\n" + text);
