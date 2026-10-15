import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] ?? 'source');
const plugin = 'packages/plugins/app-plugin-project-reports/';
async function edit(path, change) { const file = resolve(root, path); const old = await readFile(file, 'utf8'); const next = change(old); if (old === next) throw new Error(`No edit in ${path}`); await writeFile(file, next); }
await edit(plugin + 'shared/api.ts', (text) => {
  const names = ['RepositorySpec', 'IssueFact', 'IssueFacts', 'Material', 'Delta', 'CodeFigures', 'TestFigures', 'CommitFact', 'RepositoryFacts', 'RunnerFacts', 'SummaryItem', 'Summary'];
  const imports = `import type { ${names.map((name) => `${name} as ${name}Data`).join(', ')} } from './contracts.js';\n`;
  for (const name of names) {
    text = text.replace(`export const ${name} =`, `export const ${name}: z.ZodType<${name}Data> =`);
    text = text.replace(`export type ${name} = z.infer<typeof ${name}>;`, `export type ${name} = ${name}Data;`);
  }
  for (const name of ['Day', 'Timezone', 'Sha']) text = text.replace(`export const ${name} =`, `export const ${name}: z.ZodString =`);
  text = text.replace('export const Count =', 'export const Count: z.ZodNumber =');
  text = text.replace('export const SettingsInput =', `export const SettingsInput: z.ZodObject<{
    enabled: z.ZodBoolean; agentId: z.ZodNullable<z.ZodString>; timezone: z.ZodString;
    hour: z.ZodNumber; locale: z.ZodEnum<{ en: 'en'; 'zh-CN': 'zh-CN' }>; expectedRevision: z.ZodNumber;
  }, z.core.$strict> =`);
  return imports + text;
});
await edit(plugin + 'server/service.ts', (text) => text
  .replace("import type { Run } from '@nocobase/app-plugin-agents/shared/runs';", "import type { Run } from '@nocobase/app-plugin-agents/shared/runs';\nimport type { Agent } from '@nocobase/app-plugin-agents/shared/agents';")
  .replace('async requireAgent(id: string) {', 'async requireAgent(id: string): Promise<Agent> {')
  .replace("status: current.summary ? partial ? 'partial' : 'ready' : current.state === 'failed' ? 'failed' : 'generating',", "status: current.state === 'queued' || current.state === 'active' ? 'generating' : current.summary ? partial ? 'partial' : 'ready' : 'failed',")
);
await edit(plugin + 'client/components/ui/button.tsx', (text) => "import type { ReactElement } from 'react';\n" + text
  .replace('const buttonVariants = cva(', `const buttonVariants: (props?: {
    variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link' | null;
    size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg' | null;
    className?: string; class?: string;
  }) => string = cva(`)
  .replace('}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {', '}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>): ReactElement {')
);
await edit(plugin + 'client/components/ui/input.tsx', (text) => "import type { ReactElement } from 'react';\n" + text.replace('}: React.ComponentProps<\'input\'>) {', '}: React.ComponentProps<\'input\'>): ReactElement {'));
