import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] ?? 'source');
async function edit(path, change) { const file = resolve(root, path); const old = await readFile(file, 'utf8'); const next = change(old); if (old === next) throw new Error(`No edit in ${path}`); await writeFile(file, next); }
await edit('packages/plugins/app-plugin-agents/server/core/runs/ports.ts', (text) => text.replace('export interface SubjectBinding {', `export interface SubjectBinding {
  /** Optional ceiling on business commands for this subject's runs; never grants an action. The run's own universal commands remain available. */
  readonly actionCeiling?: readonly string[];`));
await edit('packages/plugins/app-plugin-agents/server/core/callers/index.ts', (text) => text
  .replace('export function createCallerGate(): CallerGate {', 'export function createCallerGate(ceiling?: (identity: CallerIdentity) => readonly string[] | undefined): CallerGate {')
  .replace('    held.add(AGENTS_VIEW_ACTION);', `    const limit = ceiling?.(identity);
    if (limit !== undefined) for (const action of held) if (!limit.includes(action)) held.delete(action);
    held.add(AGENTS_VIEW_ACTION);`));
await edit('packages/plugins/app-plugin-agents/server/composition.ts', (text) => text.replace('createCallerGate()', 'createCallerGate((identity) => identity.run ? subjects.get(identity.run.run.subjectKind)?.actionCeiling : undefined)'));
await edit('.changeset/quiet-project-reports.md', (text) => text.replace('"@nocobase/studio": minor', '"@nocobase/studio": minor\n"@nocobase/app-plugin-agents": minor'));
await edit('packages/plugins/app-plugin-agents/README.md', (text) => text + `\n### Report-only subjects\n\nA subject binding may declare an optional \`actionCeiling\`: a list of business commands its runs may keep from the host's gate. An empty list leaves only universal agent-directory and run-self commands. This narrows both the command manifest and the reach used by scoped run credentials; it grants no permission and does not change subjects that omit it. This is an API permission boundary, not an operating-system sandbox.\n`);
