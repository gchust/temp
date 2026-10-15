import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const read = name => readFileSync(path.join(root, name), 'utf8');
const write = (name, value) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), value); };
function replace(text, from, to, label) {
  if (text.split(from).length !== 2) throw new Error(`Unexpected source baseline: ${label}`);
  return text.replace(from, to);
}
const ts = createRequire(path.join(root, 'package.json'))('typescript');
const name = '@nocoreach/connector-dataforseo';
const folder = 'app-plugins/connector-dataforseo';
const manifest = JSON.parse(read('app-plugins/connector-github/package.json'));
manifest.name = name;
manifest.nocoreach.connector.id = 'dataforseo';
write(`${folder}/package.json`, JSON.stringify(manifest, null, 2) + '\n');
write(`${folder}/.gitignore`, 'dist/\nnode_modules/\n');

// These errors are shared by business consumers. Their identity must not be duplicated.
write('app-plugins/connector-sdk/server/research-helpers.ts', read('server/nocoreach/research-helpers.ts'));
write('server/nocoreach/research-helpers.ts', "// Shared compatibility contract; no provider credential or platform implementation.\nexport * from '@nocoreach/connector-sdk/server/research-helpers';\n");
// Reddit reused HN's query normalizer, not its network implementation. Share just that
// pure validation instead of making either optional connector depend on the other.
const hnFile = 'app-plugins/connector-hackernews/server/hackernews-source.ts';
const hn = read(hnFile);
const hnAst = ts.createSourceFile(hnFile, hn, ts.ScriptTarget.Latest, true);
const terms = hnAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'terms');
if (!terms) throw new Error('Missing original shared query normalizer');
let termsCode = hn.slice(terms.getStart(hnAst), terms.end).replace('function terms(input)', 'export function terms(input: unknown): string[]');
write('app-plugins/connector-sdk/server/query-terms.ts', `import { systemMessageText } from '../shared/i18n/messages.js';\nconst MAX_TERMS = 5;\nconst fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };\n${termsCode}\n`);
write(hnFile, "import { terms } from '@nocoreach/connector-sdk/server/query-terms';\n" + hn.slice(0, terms.getStart(hnAst)) + hn.slice(terms.end));

const owned = ['dataforseo', 'research-adapter', 'keyword-policy', 'keyword-service', 'rank-tracking', 'ai-search', 'lighthouse', 'reddit-source', 'trends-source'];
const shared = ['policy', 'sync-policy', 'project-runs', 'business-clock', 'research-helpers'];
const pending = [];
const errors = [];
for (const file of owned) {
  let text = read(`server/nocoreach/${file}.ts`)
    .replaceAll("'../../shared/i18n/messages.js'", "'@nocoreach/connector-sdk/shared/i18n/messages'")
    .replaceAll("'./public-sources.js'", "'@nocoreach/connector-sdk/server/public-http'")
    .replaceAll("'./hackernews-source.js'", "'@nocoreach/connector-sdk/server/query-terms'")
    .replaceAll("import type { Connections } from './plugin.js';", "import type { ConnectorRuntimeContext } from '@nocoreach/connector-sdk/server';\ntype Connections = ConnectorRuntimeContext['legacy'];");
  for (const helper of shared) text = text.replaceAll(`'./${helper}.js'`, `'@nocoreach/connector-sdk/server/${helper}'`);
  for (const match of text.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) {
    if (!owned.includes(match[1].replace(/\.js$/, ''))) errors.push(`${file} -> ${match[1]}`);
  }
  pending.push({ file, text });
}
if (errors.length) throw new Error('Unmapped provider dependencies:\n' + errors.join('\n'));
for (const { file, text } of pending) {
  write(`${folder}/server/${file}.ts`, text);
  write(`server/nocoreach/${file}.ts`, `// Compatibility path. DataForSEO request and budget logic is owned by one installed package.\nexport * from '${name}/server/${file}';\n`);
}
write(`${folder}/server/index.ts`, `import path from 'node:path';
import { defineServerPlugin, type AppPluginApplication } from '@nocobase/app-server/plugins';
import { ServiceProvider } from '@nocobase/service-provider';
import { connectorRegistryToken, type ConnectorDefinition, type ConnectorRuntimeContext } from '@nocoreach/connector-sdk/server';
import { windowFor } from '@nocoreach/connector-sdk/server/date-window';
import { KeywordService } from './keyword-service.js';
import { RankTracking } from './rank-tracking.js';
import { AiSearch } from './ai-search.js';
import { Lighthouse } from './lighthouse.js';
import { RedditSource } from './reddit-source.js';
import { TrendsSource } from './trends-source.js';
export const connector: ConnectorDefinition<ConnectorRuntimeContext> = {
  id: 'dataforseo', packageName: '${name}', apiVersion: 1,
  capabilities: [
    { id: 'keywords.research', version: 1, effect: 'read' },
    { id: 'search.rank-tracking', version: 1, effect: 'read' },
    { id: 'search.ai-visibility', version: 1, effect: 'read' },
    { id: 'website.performance', version: 1, effect: 'read' },
    { id: 'reddit.mentions', version: 1, effect: 'read' },
    { id: 'search.trends', version: 1, effect: 'read' },
  ],
  create(context) {
    const keywords = new KeywordService(context.legacy);
    const ranks = new RankTracking(context.legacy);
    const aiSearch = new AiSearch(context.legacy);
    const lighthouse = new Lighthouse(context.legacy);
    const reddit = new RedditSource(context.legacy, undefined);
    const trends = new TrendsSource(context.legacy, undefined);
    context.expose('keywordService', keywords);
    context.expose('rankTracking', ranks);
    context.expose('aiSearch', aiSearch);
    context.expose('reddit', reddit);
    context.expose('trends', trends);
    keywords.register(); ranks.register(); aiSearch.register(); lighthouse.register();
    reddit.register(windowFor); trends.register();
    const unschedule: (() => void)[] = [];
    return {
      start() {
        unschedule.push(context.schedule('rankCron', '0 0 */6 * * *', () => ranks.tick()));
        unschedule.push(context.schedule('trendsCron', '0 25 */6 * * *', () => trends.tick()));
      },
      async close() {
        for (const remove of unschedule.splice(0).reverse()) remove();
        const results = await Promise.allSettled([reddit.close(), trends.close()]);
        const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
        if (errors.length) throw new AggregateError(errors, 'Failed to close DataForSEO readers');
      },
    };
  },
};
class ConnectorProvider extends ServiceProvider<AppPluginApplication> {
  public readonly name = 'nocoreach/connector-dataforseo/provider';
  public override register(): void { this.app.container.resolve(connectorRegistryToken).register(connector); }
}
export default defineServerPlugin({ packageName: '${name}', baseDir: path.resolve(import.meta.dirname, '..'), serviceProviders: [ConnectorProvider] });
`);
let core = read('server/nocoreach/plugin.ts');
for (const [klass, file, statement] of [
  ['KeywordService', 'keyword-service', '  this.keywordService=new KeywordService(this);this.keywordService.register();\n'],
  ['RankTracking', 'rank-tracking', '  this.rankTracking=new RankTracking(this);this.rankTracking.register();\n'],
  ['AiSearch', 'ai-search', '  this.aiSearch=new AiSearch(this);this.aiSearch.register();\n'],
  ['Lighthouse', 'lighthouse', '  new Lighthouse(this).register();\n'],
  ['RedditSource', 'reddit-source', '  this.reddit=new RedditSource(this);this.reddit.register(windowFor);\n'],
  ['TrendsSource', 'trends-source', '  this.trends=new TrendsSource(this);this.trends.register();\n'],
]) {
  core = replace(core, `import { ${klass} } from './${file}.js';\n`, '', klass + ' import');
  core = replace(core, statement, '', klass + ' creation');
}
for (const timer of ['rankCron', 'trendsCron']) {
  const lines = core.split('\n');
  const old = lines.filter(line => line.trimStart().startsWith(`this.${timer}=`));
  if (old.length !== 1) throw new Error(`Missing original timer: ${timer}`);
  const cron = old[0].match(/cronTime:'([^']+)'/);
  if (!cron) throw new Error(`Missing original schedule: ${timer}`);
  const entry = read(`${folder}/server/index.ts`);
  const escaped = timer === 'rankCron' ? '0 0 */6 * * *' : '0 25 */6 * * *';
  write(`${folder}/server/index.ts`, replace(entry, `'${timer}', '${escaped}'`, `'${timer}', '${cron[1]}'`, timer + ' schedule'));
  core = lines.filter(line => !line.trimStart().startsWith(`this.${timer}=`)).join('\n');
  core = replace(core, `if(this.${timer})this.app.cronJobManager.removeJob(this.${timer});`, '', timer + ' removal');
}
core = replace(core, '[this.trends,this.reddit]', '[]', 'remaining legacy reader shutdown');
write('server/nocoreach/plugin.ts', core);
const app = JSON.parse(read('package.json'));
app.dependencies[name] = 'workspace:*';
app.files.push(folder);
write('package.json', JSON.stringify(app, null, 2) + '\n');
console.log('EXTRACTED_PROVIDER_CONNECTOR: DataForSEO research adapters, existing budgets, uncertain outcomes and caching.');
