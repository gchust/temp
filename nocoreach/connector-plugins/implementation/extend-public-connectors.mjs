import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const read = name => readFileSync(path.join(root, name), 'utf8');
const write = (name, content) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), content); };
function replace(text, from, to, label) {
  if (text.split(from).length !== 2) throw new Error(`Unexpected baseline for ${label}`);
  return text.replace(from, to);
}
const sdk = 'app-plugins/connector-sdk';
const moveShared = file => {
  write(`${sdk}/server/${file}.ts`, read(`server/nocoreach/${file}.ts`));
  write(`server/nocoreach/${file}.ts`, `// Compatibility path for consumers; one shared execution context.\nexport * from '@nocoreach/connector-sdk/server/${file}';\n`);
};
moveShared('project-runs');

// Split reusable transport from the public-source collection service. The original DNS,
// redirect, response-size and mock-routing behavior is retained, not relaxed for testing.
const original = read('server/nocoreach/public-sources.ts');
const cut = original.indexOf('async function collect(');
if (cut < 0) throw new Error('Missing public reader boundary');
let helpers = original.slice(0, cut);
helpers = helpers.replace("import { createHash } from 'node:crypto';\n", '')
  .replace("import { projectId, requireAccess } from './policy.js';\n", '')
  .replace("import * as __node_crypto from 'node:crypto';\n", '')
  .replace("import type { OutboundNetwork } from './outbound-network.js';", "import type { PublicNetwork as OutboundNetwork, PublicProxyProfile as ProxyProfile } from './public-network.js';")
  .replace("import type { Connection, ProxyProfile } from './proxy-profiles.js';", 'type Connection = string;')
  .replace("'../../shared/i18n/messages.js'", "'../shared/i18n/messages.js'");
helpers += '\nexport { normalize, publicAddress, plain, download, setPublicDns };\n';
write(`${sdk}/server/public-http.ts`, helpers);
write('server/nocoreach/public-sources.ts', `// @ts-nocheck\nimport { systemMessageText } from '../../shared/i18n/messages.js';\nimport { createHash } from 'node:crypto';\nimport * as __node_crypto from 'node:crypto';\nimport { projectId, requireAccess } from './policy.js';\nimport { normalize, publicAddress, plain, download, setPublicDns } from '@nocoreach/connector-sdk/server/public-http';\nconst fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};\n${original.slice(cut)}`);

const targets = [
  { id: 'discourse', property: 'community', file: 'community-source', klass: 'CommunitySource', cron: '30 */10 * * * *', capabilities: ['community.topics', 'community.topic-material'] },
  { id: 'packages', property: 'packages', file: 'packages-source', klass: 'PackagesSource', cron: '45 */10 * * * *', capabilities: ['packages.downloads', 'packages.versions'] },
  { id: 'hackernews', property: 'hackernews', file: 'hackernews-source', klass: 'HackerNewsSource', cron: '15 */10 * * * *', capabilities: ['community.mentions'] },
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
  let source = read(`server/nocoreach/${item.file}.ts`)
    .replaceAll("'../../shared/i18n/messages.js'", "'@nocoreach/connector-sdk/shared/i18n/messages'")
    .replaceAll("'./public-sources.js'", "'@nocoreach/connector-sdk/server/public-http'");
  for (const shared of ['policy', 'sync-policy', 'business-clock', 'project-runs']) {
    source = source.replaceAll(`'./${shared}.js'`, `'@nocoreach/connector-sdk/server/${shared}'`);
  }
  if (item.id === 'discourse') source = source.replaceAll("'./execution/community-materials.js'", "'./topic-materials.js'");
  write(`${folder}/server/${item.file}.ts`, source);
  write(`server/nocoreach/${item.file}.ts`, `// Compatibility import path; platform implementation lives in the installed package.\nexport * from '${name}/server/${item.file}';\n`);
  const capabilities = item.capabilities.map(id => ({ id, version: 1, effect: 'read' }));
  write(`${folder}/server/index.ts`, `import path from 'node:path';
import { defineServerPlugin, type AppPluginApplication } from '@nocobase/app-server/plugins';
import { ServiceProvider } from '@nocobase/service-provider';
import { connectorRegistryToken, type ConnectorDefinition, type ConnectorRuntimeContext } from '@nocoreach/connector-sdk/server';
import { ${item.klass} } from './${item.file}.js';

export const connector: ConnectorDefinition<ConnectorRuntimeContext> = {
  id: '${item.id}', packageName: '${name}', apiVersion: 1,
  capabilities: ${JSON.stringify(capabilities)},
  create(context) {
    const source = new ${item.klass}(context.legacy, undefined);
    context.expose('${item.property}', source);
    source.register();
    let unschedule: (() => void) | undefined;
    return {
      start() { unschedule = context.schedule('${item.property}Cron', '${item.cron}', () => source.tick()); },
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
  core = replace(core, `  this.${item.property}=new ${item.klass}(this);this.${item.property}.register();\n`, '', `${item.id} factory`);
  const timer = `${item.property}Cron`;
  const lines = core.split('\n');
  if (lines.filter(line => line.trimStart().startsWith(`this.${timer}=`)).length !== 1) throw new Error(`Missing timer ${timer}`);
  core = lines.filter(line => !line.trimStart().startsWith(`this.${timer}=`)).join('\n');
  core = replace(core, `if(this.${timer})this.app.cronJobManager.removeJob(this.${timer});`, '', `${item.id} timer disposal`);
  app.dependencies[name] = 'workspace:*';
  app.files.push(folder);
}
core = replace(core,
  '[this.trends,this.community,this.reddit,this.hackernews,this.packages,this.xSource,this.chat]',
  '[this.trends,this.reddit,this.xSource,this.chat]', 'legacy cleanup ownership');
write('server/nocoreach/plugin.ts', core);
write('package.json', JSON.stringify(app, null, 2) + '\n');
const topic = read('server/nocoreach/execution/community-materials.ts')
  .replace("'../../../shared/i18n/messages.js'", "'@nocoreach/connector-sdk/shared/i18n/messages'");
write('app-plugins/connector-discourse/server/topic-materials.ts', topic);
write('server/nocoreach/execution/community-materials.ts', "// Compatibility path for existing task material consumers.\nexport * from '@nocoreach/connector-discourse/server/topic-materials';\n");
console.log('EXTRACTED_PUBLIC_CONNECTORS', targets.map(item => item.id).join(', '));
