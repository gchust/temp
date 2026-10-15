import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const read = name => readFileSync(path.join(root, name), 'utf8');
const write = (name, content) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), content); };
function replace(text, from, to, label) {
  if (text.split(from).length !== 2) throw new Error(`Unexpected baseline for ${label}`);
  return text.replace(from, to);
}
const ts = createRequire(path.join(root, 'package.json'))('typescript');
let views = read('server/nocoreach/data-views.ts');
const ast = ts.createSourceFile('data-views.ts', views, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'windowFor');
if (!declaration) throw new Error('Missing date-window function');
views = views.slice(0, declaration.getStart(ast)) + views.slice(declaration.end);
views = views.replace("import { projectId, requireAccess } from './policy.js';", "import { projectId, requireAccess } from './policy.js';\nimport { windowFor } from '@nocoreach/connector-sdk/server/date-window';");
write('server/nocoreach/data-views.ts', views);

const targets = [
  { id: 'x', property: 'xSource', timer: 'xCron', file: 'x-source', klass: 'XSource', cron: '0 55 * * * *', capabilities: ['social.mentions', 'social.mention-counts'] },
  { id: 'chat', property: 'chat', timer: 'chatCron', file: 'chat-source', klass: 'ChatSource', cron: '0 15 * * * *', capabilities: ['discord.messages', 'slack.messages'] },
];
const app = JSON.parse(read('package.json'));
let core = read('server/nocoreach/plugin.ts');
for (const item of targets) {
  const name = `@nocoreach/connector-${item.id}`;
  const folder = `app-plugins/connector-${item.id}`;
  const manifest = JSON.parse(read('app-plugins/connector-github/package.json'));
  manifest.name = name;
  manifest.nocoreach.connector.id = item.id;
  write(`${folder}/package.json`, JSON.stringify(manifest, null, 2) + '\n');
  write(`${folder}/.gitignore`, 'dist/\nnode_modules/\n');
  let source = read(`server/nocoreach/${item.file}.ts`).replaceAll("'../../shared/i18n/messages.js'", "'@nocoreach/connector-sdk/shared/i18n/messages'");
  for (const shared of ['policy', 'sync-policy', 'business-clock', 'project-runs']) source = source.replaceAll(`'./${shared}.js'`, `'@nocoreach/connector-sdk/server/${shared}'`);
  write(`${folder}/server/${item.file}.ts`, source);
  write(`server/nocoreach/${item.file}.ts`, `// Compatibility import path; implementation belongs to the installed connector.\nexport * from '${name}/server/${item.file}';\n`);
  write(`${folder}/server/index.ts`, `import path from 'node:path';
import { defineServerPlugin, type AppPluginApplication } from '@nocobase/app-server/plugins';
import { ServiceProvider } from '@nocobase/service-provider';
import { connectorRegistryToken, type ConnectorDefinition, type ConnectorRuntimeContext } from '@nocoreach/connector-sdk/server';
import { windowFor } from '@nocoreach/connector-sdk/server/date-window';
import { ${item.klass} } from './${item.file}.js';
export const connector: ConnectorDefinition<ConnectorRuntimeContext> = {
  id: '${item.id}', packageName: '${name}', apiVersion: 1,
  capabilities: ${JSON.stringify(item.capabilities.map(id => ({ id, version: 1, effect: 'read' })))},
  create(context) {
    const source = new ${item.klass}(context.legacy, undefined);
    context.expose('${item.property}', source);
    source.register(windowFor);
    let unschedule: (() => void) | undefined;
    return {
      start() { unschedule = context.schedule('${item.timer}', '${item.cron}', () => source.tick()); },
      async close() { unschedule?.(); await source.close(); },
    };
  },
};
class ConnectorProvider extends ServiceProvider<AppPluginApplication> {
  public readonly name = 'nocoreach/connector-${item.id}/provider';
  public override register(): void { this.app.container.resolve(connectorRegistryToken).register(connector); }
}
export default defineServerPlugin({ packageName: '${name}', baseDir: path.resolve(import.meta.dirname, '..'), serviceProviders: [ConnectorProvider] });
`);
  core = replace(core, `import { ${item.klass} } from './${item.file}.js';\n`, '', `${item.id} import`);
  core = replace(core, `  this.${item.property}=new ${item.klass}(this);this.${item.property}.register(windowFor);\n`, '', `${item.id} factory`);
  const lines = core.split('\n');
  if (lines.filter(line => line.trimStart().startsWith(`this.${item.timer}=`)).length !== 1) throw new Error(`Missing timer ${item.timer}`);
  core = lines.filter(line => !line.trimStart().startsWith(`this.${item.timer}=`)).join('\n');
  core = replace(core, `if(this.${item.timer})this.app.cronJobManager.removeJob(this.${item.timer});`, '', `${item.id} timer disposal`);
  app.dependencies[name] = 'workspace:*';
  app.files.push(folder);
}
core = replace(core, '[this.trends,this.reddit,this.xSource,this.chat]', '[this.trends,this.reddit]', 'cleanup ownership');
write('server/nocoreach/plugin.ts', core);
write('package.json', JSON.stringify(app, null, 2) + '\n');
console.log('EXTRACTED_SOCIAL_CONNECTORS', targets.map(item => item.id).join(', '));
