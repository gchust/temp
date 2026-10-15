import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const read = name => readFileSync(path.join(root, name), 'utf8');
const write = (name, value) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), value); };
const ts = createRequire(path.join(root, 'package.json'))('typescript');
function once(text, from, to, label) {
  if (text.split(from).length !== 2) throw new Error(`Unexpected Google extraction boundary: ${label}`);
  return text.replace(from, to);
}
const folder = 'app-plugins/connector-google';
const name = '@nocoreach/connector-google';
const manifest = JSON.parse(read('app-plugins/connector-github/package.json'));
manifest.name = name;
manifest.nocoreach.connector.id = 'google';
write(`${folder}/package.json`, JSON.stringify(manifest, null, 2) + '\n');
write(`${folder}/.gitignore`, 'dist/\nnode_modules/\n');
const files = ['google-client', 'google-sync', 'sync-data', 'sync-service', 'google-oauth-callback', 'oauth-errors'];
for (const file of files) {
  let text = read(`server/nocoreach/${file}.ts`)
    .replaceAll("'../../shared/i18n/messages.js'", "'@nocoreach/connector-sdk/shared/i18n/messages'")
    .replaceAll("'./policy.js'", "'@nocoreach/connector-sdk/server/policy'")
    .replaceAll("'./legacy/context.js'", "'@nocoreach/connector-sdk/server/legacy-contracts'")
    .replaceAll("'./legacy/database.js'", "'@nocoreach/connector-sdk/server/legacy-contracts'")
    .replaceAll("import type { Connections } from './plugin.js';", "import type { GoogleConnection as Connections } from './connection.js';");
  for (const match of text.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) {
    const dep = match[1].replace(/\.js$/, '');
    if (!files.includes(dep) && dep !== 'connection') throw new Error(`Unmapped Google dependency: ${file} -> ${dep}`);
  }
  write(`${folder}/server/${file}.ts`, text);
  write(`server/nocoreach/${file}.ts`, `// Compatibility path. Google implementation and OAuth state ownership live in the installed plugin.\nexport * from '${name}/server/${file}';\n`);
}

let core = read('server/nocoreach/plugin.ts');
let ast = ts.createSourceFile('plugin.ts', core, ts.ScriptTarget.Latest, true);
const klass = ast.statements.find(s => ts.isClassDeclaration(s) && s.name?.text === 'Connections');
if (!klass) throw new Error('Missing Connections class');
const methods = ['config', 'link', 'metadata', 'token', 'resources', 'googleFetch', 'googleJson'];
const methodNodes = methods.map(name => {
  const node = klass.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(ast) === name);
  if (!node) throw new Error('Missing Google method: ' + name);
  return node;
});
const methodCode = methodNodes.map(node => core.slice(node.getStart(ast), node.end)).join('\n');
for (const node of [...methodNodes].sort((a, b) => b.getStart(ast) - a.getStart(ast))) core = core.slice(0, node.getStart(ast)) + core.slice(node.end);
const registerStart = core.indexOf('  const wrap=fn=>async(ctx,next)=>');
const registerEndMarker = "  this.app.acl.allow('nrGoogle',['status','configure','authorize','resources','select','disconnect','syncStatus','syncNow','syncControl'],'loggedIn');";
const registerEnd = core.indexOf(registerEndMarker, registerStart);
if (registerStart < 0 || registerEnd < 0) throw new Error('Missing Google resource registration block');
const registration = core.slice(registerStart, registerEnd + registerEndMarker.length).replaceAll('this: Connections', 'this: GoogleConnection');
core = core.slice(0, registerStart) + core.slice(registerEnd + registerEndMarker.length);
core = once(core, '  this.sync=new SyncService(this);\n', '', 'sync service construction');
const timerLines = core.split('\n').filter(line => line.trimStart().startsWith('this.syncCron='));
if (timerLines.length !== 1) throw new Error('Missing Google sync cron');
const cron = timerLines[0].match(/cronTime:'([^']+)'/);
if (!cron) throw new Error('Missing Google sync schedule');
core = core.split('\n').filter(line => !line.trimStart().startsWith('this.syncCron=')).join('\n');
core = once(core, 'if(this.syncCron)this.app.cronJobManager.removeJob(this.syncCron);', '', 'sync schedule cleanup');
// Registry-owned sync cleanup must not be duplicated by the legacy application.
core = core.replace('if(this.sync)await this.sync.close();', '').replace('await this.sync?.close();', '');
for (const imported of ["import * as g from './google-client.js';\n", "import { SyncService } from './sync-service.js';\n", "import { googleOAuthCallback } from './google-oauth-callback.js';\n"]) core = once(core, imported, '', imported);
core = core.replace("const CONFIG='NOREACH_GOOGLE_';\n", '');

write(`${folder}/server/connection.ts`, `// @ts-nocheck
// Existing Google action implementation moved without changing its credential, transaction or audit semantics.
import { createHash, randomBytes } from 'node:crypto';
import { systemMessageText } from '@nocoreach/connector-sdk/shared/i18n/messages';
import { projectId, secretKey, requireAccess, callbackUri, CALLBACK_PATH } from '@nocoreach/connector-sdk/server/policy';
import type { LegacyContext } from '@nocoreach/connector-sdk/server/legacy-contracts';
import * as g from './google-client.js';
import { SyncService } from './sync-service.js';
import { googleOAuthCallback } from './google-oauth-callback.js';
const CONFIG = 'NOREACH_GOOGLE_';
export class GoogleConnection {
  constructor(host) { this.host = host; this.sync = new SyncService(this); }
  get app() { return this.host.app; }
  get db() { return this.host.db; }
  get projects() { return this.host.projects; }
  get network() { return this.host.network; }
  get mock() { return this.host.mock; }
  get publicOrigin() { return this.host.publicOrigin; }
  get RETURN() { return this.host.RETURN; }
  env(key) { return this.host.env(key); }
  project(id) { return this.host.project(id); }
  projectIds() { return this.host.projectIds(); }
  variable(...args) { return this.host.variable(...args); }
${methodCode}
  register() {
${registration}
  }
}
`);
write(`${folder}/server/index.ts`, `import path from 'node:path';
import { defineServerPlugin, type AppPluginApplication } from '@nocobase/app-server/plugins';
import { ServiceProvider } from '@nocobase/service-provider';
import { connectorRegistryToken, type ConnectorDefinition, type ConnectorRuntimeContext } from '@nocoreach/connector-sdk/server';
import { GoogleConnection } from './connection.js';
export const connector: ConnectorDefinition<ConnectorRuntimeContext> = {
  id: 'google', packageName: '${name}', apiVersion: 1,
  capabilities: [
    { id: 'google.oauth', version: 1, effect: 'read' },
    { id: 'analytics.ga4', version: 1, effect: 'read' },
    { id: 'search-console.metrics', version: 1, effect: 'read' },
  ],
  create(context) {
    const google = new GoogleConnection(context.legacy);
    context.expose('google', google);
    context.expose('sync', google.sync);
${methods.map(method => `    context.expose('${method}', google.${method}.bind(google));`).join('\n')}
    google.register();
    let unschedule: (() => void) | undefined;
    return {
      start() { unschedule = context.schedule('syncCron', '${cron[1]}', () => google.sync.tick()); },
      async close() { unschedule?.(); await google.sync.close(); },
    };
  },
};
class ConnectorProvider extends ServiceProvider<AppPluginApplication> {
  public readonly name = 'nocoreach/connector-google/provider';
  public override register(): void { this.app.container.resolve(connectorRegistryToken).register(connector); }
}
export default defineServerPlugin({ packageName: '${name}', baseDir: path.resolve(import.meta.dirname, '..'), serviceProviders: [ConnectorProvider] });
`);
write('server/nocoreach/plugin.ts', core);
const app = JSON.parse(read('package.json'));
app.dependencies[name] = 'workspace:*';
app.files.push(folder);
write('package.json', JSON.stringify(app, null, 2) + '\n');
console.log('EXTRACTED_GOOGLE_CONNECTOR: OAuth callback, credentials, resources, GSC/GA4 partitions and scheduler.');
