import { readFile, writeFile, cp, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(process.argv[2] ?? 'source');
const here = dirname(new URL(import.meta.url).pathname);
await cp(resolve(here, 'patch'), root, { recursive: true });
async function edit(path, change) {
  const full = resolve(root, path); const before = await readFile(full, 'utf8'); const after = change(before);
  if (before === after) throw new Error(`Expected a change in ${path}`);
  await writeFile(full, after);
}
await edit('packages/plugins/app-plugin-project-reports/shared/dates.ts', (text) => text.replace("new Date(`${value}T00:00:00Z`).toISOString()", "Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString()"));
await edit('packages/plugins/app-plugin-project-reports/runner/collector.mjs', (text) => text
  .replace("import { promisify } from 'node:util';\n", '')
  .replace('const execute = promisify(execFile);\n', '')
  .replace(/async function git\(directory, args, options = \{\}\) \{[\s\S]*?\n\}\n\nexport function category/u, `function git(directory, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never', ...(directory ? ['--git-dir', directory] : []), ...args], {
      encoding: 'utf8', timeout: 120_000, maxBuffer: MAX_BUFFER,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' }, ...options,
    }, (error, stdout) => error ? reject(new Error('GIT_COMMAND_FAILED')) : resolve(stdout));
    child.stdin?.end(options.input ?? '');
  });
}

export function category`)
  .replace('if (files.length === 0 || files.length > 2000) return null;', "if (files.length === 0) return { method: 'empty', tests: [] };\n  if (files.length > 2000) return null;"));

if (process.env.REPORTS_PHASE !== 'full') process.exit(0);
await edit('packages/plugins/app-plugin-projects/server/domains/reports/report.service.ts', (text) => {
  text = "import { issueDailyFacts, type IssueDailyFacts } from './daily.js';\n" + text;
  text = text.replace('export interface IssueReports {', 'export interface IssueReports {\n  daily(viewer: Viewer, query: { projectId: string; from: Date; to: Date }): Promise<IssueDailyFacts>;');
  return text.replace('    async report(viewer, query) {', '    daily: (viewer, query) => issueDailyFacts(deps.tx.read(), viewer, query),\n\n    async report(viewer, query) {');
});
await edit('packages/apps/studio/server/plugins.ts', (text) => "import projectReports from '@nocobase/app-plugin-project-reports/server';\n" + text.replace('  agentSessions,', '  agentSessions,\n  projectReports,'));
await edit('packages/apps/studio/client/plugins.ts', (text) => "import projectReports from '@nocobase/app-plugin-project-reports/client';\n" + text);
await edit('packages/apps/studio/package.json', (text) => {
  const pkg = JSON.parse(text); pkg.dependencies['@nocobase/app-plugin-project-reports'] = 'workspace:^'; return JSON.stringify(pkg, null, 2) + '\n';
});
const target = 'packages/plugins/app-plugin-project-reports/client';
for (const file of ['components/page-container.tsx', 'components/page-header.tsx', 'components/ui/button.tsx', 'components/ui/input.tsx']) {
  const path = resolve(root, target, file); await mkdir(dirname(path), { recursive: true });
  await cp(resolve(root, 'packages/apps/studio/client', file), path);
}
for (const script of ['runtime-patches.mjs', 'integration-patches.mjs']) execFileSync(process.execPath, [resolve(here, script), root], { stdio: 'inherit' });
