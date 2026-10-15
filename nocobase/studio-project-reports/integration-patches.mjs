import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] ?? 'source');
async function edit(path, change) { const file = resolve(root, path); const old = await readFile(file, 'utf8'); const next = change(old); if (old === next) throw new Error(`No edit in ${path}`); await writeFile(file, next); }
await edit('packages/apps/studio/client/plugins.ts', (text) => text.replace('  agentSessions({ routes: false }),', '  agentSessions({ routes: false }),\n  projectReports(),'));
await edit('packages/apps/studio/client/styles.css', (text) => text.replace('@source "./components/ui";', '@source "./components/ui";\n@source "../node_modules/@nocobase/app-plugin-project-reports/dist/client";\n@source "../node_modules/@nocobase/app-plugin-project-reports/client";'));
