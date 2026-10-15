import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const read = name => readFileSync(path.join(root, name), 'utf8');
const write = (name, value) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), value); };
const ts = createRequire(path.join(root, 'package.json'))('typescript');
function replace(text, from, to, label) {
  if (text.split(from).length !== 2) throw new Error(`Unexpected baseline: ${label}`);
  return text.replace(from, to);
}
function takeClass(file, name) {
  const text = read(file);
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === name);
  if (!node) throw new Error(`Cannot find class ${name} in ${file}`);
  const extracted = text.slice(node.getStart(ast), node.end);
  write(file, `import { ${name} } from '@nocoreach/connector-sdk/server/network-errors';\nexport { ${name} };\n` + text.slice(0, node.getStart(ast)) + text.slice(node.end));
  return extracted;
}
const errors = [takeClass('server/nocoreach/proxy-profiles.ts', 'ProxyConfigurationError'), takeClass('server/nocoreach/profile-routing.ts', 'NetworkProfileError')];
write('app-plugins/connector-sdk/server/network-errors.ts', '// Shared error identities preserve fail-closed handling across installed packages.\n' + errors.join('\n\n') + '\n');

const name = '@nocoreach/connector-website';
const folder = 'app-plugins/connector-website';
const manifest = JSON.parse(read('app-plugins/connector-github/package.json'));
manifest.name = name;
manifest.nocoreach.connector.id = 'website';
write(`${folder}/package.json`, JSON.stringify(manifest, null, 2) + '\n');
write(`${folder}/.gitignore`, 'dist/\nnode_modules/\n');
const services = [
  { file: 'public-sources', klass: 'PublicSources', local: 'sources', statement: '  this.sources=new PublicSources(this);this.sources.register();\n' },
  { file: 'site-content', klass: 'SiteContent', local: 'siteContent', statement: '  this.siteContent=new SiteContent(this);this.siteContent.register();\n' },
  { file: 'audit', klass: 'SiteAudit', local: 'audit', statement: '  this.audit=new SiteAudit(this);this.audit.register();\n' },
];
const constructors = [];
let core = read('server/nocoreach/plugin.ts');
for (const service of services) {
  let text = read(`server/nocoreach/${service.file}.ts`)
    .replaceAll("'../../shared/i18n/messages.js'", "'@nocoreach/connector-sdk/shared/i18n/messages'")
    .replaceAll("'./proxy-profiles.js'", "'@nocoreach/connector-sdk/server/network-errors'")
    .replaceAll("'./profile-routing.js'", "'@nocoreach/connector-sdk/server/network-errors'");
  for (const helper of ['policy', 'sync-policy', 'project-runs', 'business-clock']) text = text.replaceAll(`'./${helper}.js'`, `'@nocoreach/connector-sdk/server/${helper}'`);
  const ast = ts.createSourceFile(service.file + '.ts', text, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === service.klass);
  if (!klass) throw new Error(`Missing ${service.klass}`);
  const constructor = klass.members.find(ts.isConstructorDeclaration);
  const required = constructor?.parameters.filter(parameter => !parameter.initializer && !parameter.questionToken).length ?? 0;
  const args = ['context.legacy', ...Array.from({ length: Math.max(required - 1, 0) }, () => 'undefined')];
  constructors.push(`    const ${service.local} = new ${service.klass}(${args.join(', ')});\n    context.expose('${service.local}', ${service.local});\n    ${service.local}.register();`);
  write(`${folder}/server/${service.file}.ts`, text);
  write(`server/nocoreach/${service.file}.ts`, `// Compatibility path for existing consumers; the website plugin owns this implementation.\nexport * from '${name}/server/${service.file}';\n`);
  core = replace(core, `import { ${service.klass} } from './${service.file}.js';\n`, '', service.klass + ' import');
  core = replace(core, service.statement, '', service.klass + ' registration');
}
const timerLines = core.split('\n').filter(line => line.trimStart().startsWith('this.siteCron='));
if (timerLines.length !== 1) throw new Error('Missing siteCron');
const cron = timerLines[0].match(/cronTime:'([^']+)'/);
if (!cron) throw new Error('Missing website schedule');
core = core.split('\n').filter(line => !line.trimStart().startsWith('this.siteCron=')).join('\n');
core = replace(core, 'if(this.siteCron)this.app.cronJobManager.removeJob(this.siteCron);', '', 'site timer cleanup');
write(`${folder}/server/index.ts`, `import path from 'node:path';
import { defineServerPlugin, type AppPluginApplication } from '@nocobase/app-server/plugins';
import { ServiceProvider } from '@nocobase/service-provider';
import { connectorRegistryToken, type ConnectorDefinition, type ConnectorRuntimeContext } from '@nocoreach/connector-sdk/server';
${services.map(service => `import { ${service.klass} } from './${service.file}.js';`).join('\n')}
export const connector: ConnectorDefinition<ConnectorRuntimeContext> = {
  id: 'website', packageName: '${name}', apiVersion: 1,
  capabilities: [
    { id: 'website.capture', version: 1, effect: 'read' },
    { id: 'website.inventory', version: 1, effect: 'read' },
    { id: 'website.audit', version: 1, effect: 'read' },
    { id: 'feed.read', version: 1, effect: 'read' },
  ],
  create(context) {
${constructors.join('\n')}
    let unschedule: (() => void) | undefined;
    return {
      start() { unschedule = context.schedule('siteCron', '${cron[1]}', () => siteContent.tick()); },
      close() { unschedule?.(); },
    };
  },
};
class ConnectorProvider extends ServiceProvider<AppPluginApplication> {
  public readonly name = 'nocoreach/connector-website/provider';
  public override register(): void { this.app.container.resolve(connectorRegistryToken).register(connector); }
}
export default defineServerPlugin({ packageName: '${name}', baseDir: path.resolve(import.meta.dirname, '..'), serviceProviders: [ConnectorProvider] });
`);
write('server/nocoreach/plugin.ts', core);
const app = JSON.parse(read('package.json'));
app.dependencies[name] = 'workspace:*';
app.files.push(folder);
write('package.json', JSON.stringify(app, null, 2) + '\n');
console.log('EXTRACTED_WEBSITE_CONNECTOR: public capture, sitemap inventory and local audit; network guard identities are shared.');
