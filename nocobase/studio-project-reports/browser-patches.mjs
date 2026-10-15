import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] ?? 'source');
const file = resolve(root, 'packages/apps/studio/e2e/support/runner.ts');
let text = await readFile(file, 'utf8');
text = text.replace("readonly trust?: 'team' | 'ownerOnly';", "readonly trust?: 'team' | 'ownerOnly';\n      readonly mounts?: boolean;");
text = text.replace("...(this.workspaceKey ? ['workspaceKey'] : []),", "...(this.workspaceKey ? ['workspaceKey'] : []),\n          ...(this.options.mounts ? ['mounts'] : []),");
await writeFile(file, text);
