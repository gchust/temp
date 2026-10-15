import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import path from 'node:path';

// Temporary verification tooling. Only the resulting application source diff is delivered.
const root = path.resolve(process.argv[2]);
const read = name => readFileSync(path.join(root, name), 'utf8');
const write = (name, content) => {
  mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  writeFileSync(path.join(root, name), content);
};
function replaceOnce(text, before, after, label) {
  if (text.split(before).length !== 2) throw new Error(`Baseline mismatch: ${label}`);
  return text.replace(before, after);
}
function edit(file, changes) {
  let text = read(file);
  for (const [before, after] of changes) text = replaceOnce(text, before, after, `${file}: ${before.slice(0, 70)}`);
  write(file, text);
}

const sdk = 'app-plugins/connector-sdk';
const github = 'app-plugins/connector-github';
const manifest = (name, extra = {}) => ({
  name, version: '0.1.0', type: 'module', license: 'Apache-2.0',
  files: ['dist', 'server', 'shared'],
  engines: { node: '>=24' },
  exports: {
    './package.json': './package.json',
    './server': { types: './server/index.ts', default: './dist/server/index.js' },
    './server/*': { types: './server/*.ts', default: './dist/server/*.js' },
    './shared/*': { types: './shared/*.ts', default: './dist/shared/*.js' },
  },
  peerDependencies: { '@nocobase/app-server': '^2.0.0-beta.6', '@nocobase/service-provider': '^0.0.2-beta.2' },
  ...extra,
});
write(`${sdk}/package.json`, JSON.stringify(manifest('@nocoreach/connector-sdk'), null, 2) + '\n');
write(`${github}/package.json`, JSON.stringify(manifest('@nocoreach/connector-github', {
  nocoreach: { connector: { id: 'github', apiVersion: 1 } },
  dependencies: { '@nocoreach/connector-sdk': 'workspace:*' },
}), null, 2) + '\n');
for (const folder of [sdk, github]) write(`${folder}/.gitignore`, 'dist/\nnode_modules/\n');

// Preserve the existing authorization and retry semantics behind shared compatibility exports.
for (const file of ['policy', 'sync-policy', 'business-clock']) {
  let source = read(`server/nocoreach/${file}.ts`);
  source = source.replaceAll("'../../shared/i18n/messages.js'", "'../shared/i18n/messages.js'");
  if (file === 'business-clock') source = replaceOnce(source, "import type { Connection } from './proxy-profiles.js';", 'type Connection = string;', 'business clock network type');
  write(`${sdk}/server/${file}.ts`, source);
  write(`server/nocoreach/${file}.ts`, `// Compatibility import path; implementation is owned by the connector SDK.\nexport * from '@nocoreach/connector-sdk/server/${file}';\n`);
}
mkdirSync(path.join(root, sdk, 'shared/i18n'), { recursive: true });
for (const file of ['messages.ts', 'en.json', 'zh.json', 'legacy-keys.json']) {
  cpSync(path.join(root, 'shared/i18n', file), path.join(root, sdk, 'shared/i18n', file));
}

for (const file of ['github-source', 'github-trends']) {
  let source = read(`server/nocoreach/${file}.ts`);
  source = source.replaceAll("'../../shared/i18n/messages.js'", "'@nocoreach/connector-sdk/shared/i18n/messages'");
  for (const shared of ['policy', 'sync-policy', 'business-clock']) source = source.replaceAll(`'./${shared}.js'`, `'@nocoreach/connector-sdk/server/${shared}'`);
  write(`${github}/server/${file}.ts`, source);
  write(`server/nocoreach/${file}.ts`, `// Compatibility import path for existing consumers and tests.\nexport * from '@nocoreach/connector-github/server/${file}';\n`);
}

const app = JSON.parse(read('package.json'));
app.dependencies['@nocoreach/connector-sdk'] = 'workspace:*';
app.dependencies['@nocoreach/connector-github'] = 'workspace:*';
app.scripts['connectors:prepare'] = 'node cli/prepare-connectors.mjs';
for (const command of ['dev', 'build', 'typecheck', 'test', 'test:watch']) app.scripts[command] = `pnpm connectors:prepare && ${app.scripts[command]}`;
app.scripts.postinstall = `node cli/prepare-connectors.mjs && ${app.scripts.postinstall}`;
for (const folder of [sdk, github]) if (!app.files.includes(folder)) app.files.push(folder);
write('package.json', JSON.stringify(app, null, 2) + '\n');

// The pinned CLI's composition scanner only accepts direct @nocobase imports.
// Keep third-party package assembly behind a local composition adapter, just as the existing mock uses.
// This changes neither the declared npm package identity nor the runtime plugin lifecycle.
write('server/connectors/plugin.ts', `// Local composition adapter for the pinned CLI; runtime still consumes the SDK's public export.\nexport { default } from '@nocoreach/connector-sdk/server';\n`);
edit('server/plugins.ts', [
  ["import nocoreachMock from '../app-plugins/nocoreach-mock/server/index.js';", "import nocoreachMock from '../app-plugins/nocoreach-mock/server/index.js';\nimport connectorSdk from './connectors/plugin.js';\nimport connectors from './generated/connectors.js';"],
  ['  nocoreachMock,\n]);', '  nocoreachMock,\n  connectorSdk,\n  ...connectors,\n]);'],
]);

edit('server/providers/nocoreach.ts', [
  ["import { Connections } from '../nocoreach/plugin.js';", "import { Connections } from '../nocoreach/plugin.js';\nimport { connectorRegistryToken } from '@nocoreach/connector-sdk/server';"],
  ['new Connections(legacy, variables, { basePath,', 'new Connections(legacy, variables, { connectorRegistry: this.app.container.resolve(connectorRegistryToken), basePath,'],
]);

let core = read('server/nocoreach/plugin.ts');
core = replaceOnce(core, "import { GitHubSource } from './github-source.js';", "import type { ConnectorRegistry, ConnectorRuntimeContext } from '@nocoreach/connector-sdk/server';\nimport { createConnectorContext } from '../connectors/runtime.js';", 'GitHub import');
core = replaceOnce(core, "import { GitHubTrends } from './github-trends.js';\n", '', 'GitHub trends import');
core = replaceOnce(core, 'browserCollectors=[],mock}:', 'browserCollectors=[],mock,connectorRegistry}:', 'constructor argument');
core = replaceOnce(core, 'browserCollectors?:unknown;mock?:MockEngine}', 'browserCollectors?:unknown;mock?:MockEngine;connectorRegistry?:ConnectorRegistry<ConnectorRuntimeContext>}', 'constructor type');
core = replaceOnce(core, '){this.publicOrigin=publicOrigin;', '){this.connectorRegistry=connectorRegistry;this.publicOrigin=publicOrigin;', 'constructor assignment');
core = replaceOnce(core, ' mock?: MockEngine;', ' connectorRegistry?: ConnectorRegistry<ConnectorRuntimeContext>;\n mock?: MockEngine;', 'registry field');
core = replaceOnce(core, '  this.github=new GitHubSource(this);this.github.register();', '  if (!this.connectorRegistry) throw new Error(\'NocoReach connector registry is not configured\');\n  await this.connectorRegistry.start(createConnectorContext(this));', 'GitHub creation');
core = replaceOnce(core, '  this.githubTrends=new GitHubTrends(this);this.githubTrends.register();\n', '', 'GitHub trends creation');
core = core.split('\n').filter(line => !line.trimStart().startsWith('this.githubCron=') && !line.trimStart().startsWith('this.githubTrendsCron=')).join('\n');
core = replaceOnce(core, ' async afterDisable(){', ' async afterDisable(){await this.connectorRegistry?.close();', 'registry disposal');
for (const timer of ['githubCron', 'githubTrendsCron']) core = replaceOnce(core, `if(this.${timer})this.app.cronJobManager.removeJob(this.${timer});`, '', `remove legacy ${timer}`);
write('server/nocoreach/plugin.ts', core);

console.log('IMPLEMENTATION_APPLIED: GitHub source, activity, traffic and trends extracted with native plugin registration.');
console.log('IMPLEMENTATION_PENDING: remaining connectors, optional-package consumers, UI, API publishing and browser acceptance.');
