import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const read = file => readFileSync(path.join(root, file), 'utf8');
const write = (file, text) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); };
const ts = createRequire(path.join(root, 'package.json'))('typescript');
function once(text, from, to, label) {
  if (text.split(from).length !== 2) throw new Error(`Unexpected media extraction boundary: ${label}`);
  return text.replace(from, to);
}
const mockOriginal = read('server/nocoreach/mock-collectors.ts');
const mockAst = ts.createSourceFile('mock-collectors.ts', mockOriginal, ts.ScriptTarget.Latest, true);
function originalFunction(name) {
  const node = mockAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!node) throw new Error('Missing original mock adapter function: ' + name);
  return mockOriginal.slice(node.getStart(mockAst), node.end);
}
// The fixture protocol is neutral. The optional simulator and production connectors
// share one contract without a runtime dependency from the SDK back to the simulator.
write('app-plugins/connector-sdk/shared/mock-types.ts', read('app-plugins/nocoreach-mock/server/types.ts'));
write('app-plugins/nocoreach-mock/server/types.ts', "export * from '@nocoreach/connector-sdk/shared/mock-types';\n");
const mockPackage = JSON.parse(read('app-plugins/nocoreach-mock/package.json'));
mockPackage.dependencies = { ...mockPackage.dependencies, '@nocoreach/connector-sdk': 'workspace:*' };
write('app-plugins/nocoreach-mock/package.json', JSON.stringify(mockPackage, null, 2) + '\n');
const collector = read('server/nocoreach/browser-collector-config.ts').replaceAll("'../../shared/i18n/messages.js'", "'@nocoreach/connector-sdk/shared/i18n/messages'");
write('app-plugins/connector-sdk/server/browser-collector-config.ts', collector);
write('server/nocoreach/browser-collector-config.ts', "export * from '@nocoreach/connector-sdk/server/browser-collector-config';\n");
const sdk = JSON.parse(read('app-plugins/connector-sdk/package.json'));
const app = JSON.parse(read('package.json'));
sdk.dependencies = { ...sdk.dependencies, zod: app.dependencies.zod };
write('app-plugins/connector-sdk/package.json', JSON.stringify(sdk, null, 2) + '\n');

const media = [
  { id: 'youtube', klass: 'YouTubeSource', files: ['youtube-source', 'youtube-provider', 'youtube-library'], factory: 'createMockYouTubeProvider', methods: ['video.search', 'video.details', 'video.transcript'] },
  { id: 'bilibili', klass: 'BilibiliSource', files: ['bilibili-source', 'bilibili-adapter'], factory: 'createMockBilibiliAdapter', methods: ['video.search', 'video.details'] },
  { id: 'xiaohongshu', klass: 'XiaohongshuSource', files: ['xiaohongshu-source', 'xiaohongshu-adapter'], factory: 'createMockXiaohongshuAdapter', methods: ['note.search', 'note.details'] },
];
let core = read('server/nocoreach/plugin.ts');
for (const mediaPlugin of media) {
  const { id, klass, files, factory, methods } = mediaPlugin;
  const name = `@nocoreach/connector-${id}`;
  const folder = `app-plugins/connector-${id}`;
  const manifest = JSON.parse(read('app-plugins/connector-github/package.json'));
  manifest.name = name;
  manifest.nocoreach.connector.id = id;
  manifest.dependencies = { ...manifest.dependencies, zod: app.dependencies.zod };
  manifest.peerDependencies = { ...manifest.peerDependencies, '@nocoreach/app-plugin-mock': '^0.1.0' };
  manifest.peerDependenciesMeta = { '@nocoreach/app-plugin-mock': { optional: true } };
  write(`${folder}/package.json`, JSON.stringify(manifest, null, 2) + '\n');
  write(`${folder}/.gitignore`, 'dist/\nnode_modules/\n');
  for (const file of files) {
    let code = read(`server/nocoreach/${file}.ts`)
      .replaceAll("'../../shared/i18n/messages.js'", "'@nocoreach/connector-sdk/shared/i18n/messages'")
      .replaceAll("'./policy.js'", "'@nocoreach/connector-sdk/server/policy'")
      .replaceAll("'./sync-policy.js'", "'@nocoreach/connector-sdk/server/sync-policy'")
      .replaceAll("'./browser-collector-config.js'", "'@nocoreach/connector-sdk/server/browser-collector-config'")
      .replaceAll("'./public-sources.js'", "'@nocoreach/connector-sdk/server/public-http'")
      .replaceAll("'./legacy/database.js'", "'@nocoreach/connector-sdk/server/legacy-media'")
      .replaceAll("'./legacy/app.js'", "'@nocoreach/connector-sdk/server/legacy-media'")
      .replaceAll("'./legacy/context.js'", "'@nocoreach/connector-sdk/server/legacy-media'")
      .replaceAll("'./outbound-network.js'", "'@nocoreach/connector-sdk/server/legacy-media'")
      .replaceAll("import type { ProxyProfile } from './proxy-profiles.js';", "import type { PublicProxyProfile as ProxyProfile } from '@nocoreach/connector-sdk/server/public-network';")
      .replace('import type { legacyContext }', 'import type { LegacyContext }')
      .replace('type Context = ReturnType<typeof legacyContext>;', 'type Context = LegacyContext;');
    const unowned = [...code.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)].map(match => match[1].replace(/\.js$/, '')).filter(dep => !files.includes(dep));
    if (unowned.length) throw new Error(`Unmapped ${id} dependencies in ${file}: ${unowned.join(', ')}`);
    write(`${folder}/server/${file}.ts`, code);
    write(`server/nocoreach/${file}.ts`, `// Compatibility import; implementation belongs to the independently installed ${id} package.\nexport * from '${name}/server/${file}';\n`);
  }
  const common = `import { freezeMockCollectorContext, mockCollectorTransport, mockYouTubeDependencies, MockMediaError } from '@nocoreach/app-plugin-mock/collectors';\nimport type { MockRunContext } from '@nocoreach/connector-sdk/shared/mock-types';\nimport type { OutboundNetwork } from '@nocoreach/connector-sdk/server/legacy-media';\n`;
  let testCode;
  if (id === 'youtube') {
    let adapter = originalFunction('youtube');
    adapter = once(adapter,
      'const network = { selected: () => undefined } as unknown as OutboundNetwork;',
      `const denied = (): never => { throw new Error('Simulated YouTube cannot fall back to a real network or tool'); };\n  const network: OutboundNetwork = { selected: () => undefined, fetch: denied, send: denied, bind: denied, mockContext: denied };`,
      'YouTube mock network dependency');
    testCode = common + `import { YouTubeProvider, YouTubeError, type YouTubeRunner } from './youtube-provider.js';\ntype YouTubeContext = MockRunContext | (() => MockRunContext);\n` + adapter + '\n' + originalFunction(factory) + '\n';
  } else {
    const label = id === 'bilibili' ? 'Bilibili' : 'Xiaohongshu';
    testCode = common + `import { Http${label}Adapter, ${label}Error, type ${label}Adapter } from './${id}-adapter.js';\ntype CollectorContext = MockRunContext | ((projectId: string) => MockRunContext);\n` + originalFunction('collectorContext') + '\n' + originalFunction(factory) + '\n';
  }
  write(`${folder}/server/testing.ts`, testCode);
  let schedule = '';
  if (id === 'youtube') {
    const lines = core.split('\n');
    const timer = lines.filter(line => line.trimStart().startsWith('this.youtubeCron='));
    if (timer.length !== 1) throw new Error('Missing YouTube original schedule');
    const cron = timer[0].match(/cronTime:'([^']+)'/);
    if (!cron) throw new Error('Invalid YouTube original schedule');
    schedule = `unschedule = context.schedule('youtubeCron', '${cron[1]}', () => source.tick());`;
    core = lines.filter(line => !line.trimStart().startsWith('this.youtubeCron=') && line.trim() !== 'const youtubeApp=this.app as LegacyApp;').join('\n');
    core = once(core, 'if(this.youtubeCron)(this.app as LegacyApp).cronJobManager.removeJob(this.youtubeCron);', '', 'YouTube timer cleanup');
    core = once(core, 'if(this.youtube)await this.youtube.stop();', '', 'YouTube stop ownership');
  } else {
    core = once(core, `this.${id}?.stop();`, '', `${id} stop ownership`);
  }
  const old = id === 'youtube'
    ? `  this.youtube=new YouTubeSource(this,this.mock?.enabled?createMockYouTubeProvider(()=>this.network.mockContext('youtube')):undefined);this.youtube.register();\n`
    : `  this.${id}=new ${klass}(this,this.browserCollectors,this.mock?.enabled?${factory}(id=>this.network.mockContext('${id}',id)):undefined);this.${id}.register();\n`;
  core = once(core, old, '', `${id} source construction`);
  core = once(core, `import { ${klass} } from './${id}-source.js';\n`, '', `${id} implementation import`);
  if (id === 'xiaohongshu') core = once(core, "  this.network.bind(this.xiaohongshu,['test','search'],'xiaohongshu');\n", '', 'Xiaohongshu binding');
  write(`${folder}/server/index.ts`, `import path from 'node:path';
import { defineServerPlugin, type AppPluginApplication } from '@nocobase/app-server/plugins';
import { ServiceProvider } from '@nocobase/service-provider';
import { connectorRegistryToken, type ConnectorDefinition, type ConnectorRuntimeContext } from '@nocoreach/connector-sdk/server';
import { requireMediaHost } from '@nocoreach/connector-sdk/server/legacy-media';
import { ${klass} } from './${id}-source.js';
export const connector: ConnectorDefinition<ConnectorRuntimeContext> = {
  id: '${id}', packageName: '${name}', apiVersion: 1,
  capabilities: ${JSON.stringify(methods.map(key => ({ id: `${id}.${key}`, version: 1, effect: 'read' })))},
  async create(context) {
    const host = requireMediaHost(context.legacy);
    const adapter = host.mock?.enabled
      ? (await import('./testing.js')).${factory}(${id === 'youtube' ? "() => host.network.mockContext('youtube')" : `project => host.network.mockContext('${id}', project)`})
      : undefined;
    const source = new ${klass}(host, ${id === 'youtube' ? 'adapter' : 'host.browserCollectors, adapter'});
    context.expose('${id}', source);
    source.register();
    ${id === 'xiaohongshu' ? "host.network.bind(source, ['test', 'search'], 'xiaohongshu');" : ''}
    let unschedule: (() => void) | undefined;
    return {
      start() { ${schedule} },
      async close() { unschedule?.(); await source.stop(); },
    };
  },
};
class ConnectorProvider extends ServiceProvider<AppPluginApplication> {
  public readonly name = 'nocoreach/connector-${id}/provider';
  public override register(): void { this.app.container.resolve(connectorRegistryToken).register(connector); }
}
export default defineServerPlugin({ packageName: '${name}', baseDir: path.resolve(import.meta.dirname, '..'), serviceProviders: [ConnectorProvider] });
`);
  app.dependencies[name] = 'workspace:*';
  app.files.push(folder);
}
core = once(core, "import { createMockXiaohongshuAdapter, createMockBilibiliAdapter, createMockYouTubeProvider } from './mock-collectors.js';\n", '', 'central mock factory assembly');
write('server/nocoreach/plugin.ts', core);
write('server/nocoreach/mock-collectors.ts', `// Compatibility for existing contract tests; each installed media plugin now owns its normalization and simulator bridge.\n${media.map(m => `export { ${m.factory} } from '@nocoreach/connector-${m.id}/server/testing';`).join('\n')}\nexport { mockBrowserCollectors } from '@nocoreach/app-plugin-mock/collectors';\n`);
write('package.json', JSON.stringify(app, null, 2) + '\n');
console.log('EXTRACTED_MEDIA_CONNECTORS: YouTube, Bilibili, Xiaohongshu; original transactions, histories, cancellation and production parsers retained.');
