import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile, writeFile, mkdir, readdir, copyFile, stat } from 'node:fs/promises';

const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

/** Read only explicitly installed direct dependencies. Never evaluate a package to discover it. */
export async function discoverConnectors(root) {
  const app = await readJson(path.join(root, 'package.json'));
  const require = createRequire(path.join(root, 'package.json'));
  const found = [];
  const ids = new Set();
  for (const name of Object.keys(app.dependencies ?? {}).sort()) {
    if (!packageNamePattern.test(name)) throw new Error(`Invalid dependency package name: ${name}`);
    let manifestPath;
    try { manifestPath = require.resolve(`${name}/package.json`); }
    catch (error) {
      if (name.startsWith('@nocoreach/connector-')) throw new Error(`Connector must export package.json: ${name}`, { cause: error });
      if (error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || error?.code === 'MODULE_NOT_FOUND') continue;
      throw error;
    }
    const manifest = await readJson(manifestPath);
    const connector = manifest.nocoreach?.connector;
    if (!connector) continue;
    if (manifest.name !== name || connector.apiVersion !== 1 || !/^[a-z][a-z0-9-]*$/.test(connector.id ?? '')) {
      throw new Error(`Invalid connector manifest: ${name}`);
    }
    if (ids.has(connector.id)) throw new Error(`Duplicate connector ID: ${connector.id}`);
    if (typeof manifest.exports !== 'object' || !manifest.exports['./server']) throw new Error(`Missing server export: ${name}`);
    if (connector.client && !manifest.exports['./client']) throw new Error(`Missing client export: ${name}`);
    ids.add(connector.id);
    found.push({ id: connector.id, name, version: manifest.version, root: path.dirname(manifestPath), client: Boolean(connector.client) });
  }
  return found;
}

async function filesIn(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) files.push(...await filesIn(path.join(dir, entry.name)));
    else if (entry.isFile()) files.push(path.join(dir, entry.name));
  }
  return files;
}

async function writeChanged(file, contents) {
  try { if (await readFile(file, 'utf8') === contents) return; }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
}

/** Build first-party workspace source only; third-party packages supply their own compiled exports. */
async function buildWorkspacePackage(root, name) {
  const app = await readJson(path.join(root, 'package.json'));
  if (!String(app.dependencies?.[name] ?? '').startsWith('workspace:')) return;
  const require = createRequire(path.join(root, 'package.json'));
  const packageRoot = path.dirname(require.resolve(`${name}/package.json`));
  const sourceRoot = path.join(root, 'app-plugins');
  // Workspace packages in this repository are trusted source, but do not follow arbitrary package roots.
  if (!path.resolve(packageRoot).startsWith(path.resolve(sourceRoot) + path.sep)) {
    throw new Error(`Expected an application workspace package: ${name}`);
  }
  const ts = require('typescript');
  for (const area of ['server', 'shared', 'client']) {
    for (const file of await filesIn(path.join(packageRoot, area))) {
      const relative = path.relative(packageRoot, file);
      const output = path.join(packageRoot, 'dist', relative.replace(/\.tsx?$/, '.js'));
      if (/\.tsx?$/.test(file) && !file.endsWith('.d.ts')) {
        const result = ts.transpileModule(await readFile(file, 'utf8'), {
          fileName: file,
          reportDiagnostics: true,
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: true },
        });
        const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
        if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
          getCanonicalFileName: file => file,
          getCurrentDirectory: () => root,
          getNewLine: () => '\n',
        }));
        await writeChanged(output, result.outputText);
      } else if (file.endsWith('.json')) {
        await mkdir(path.dirname(output), { recursive: true });
        await copyFile(file, output);
      }
    }
  }
}

export async function prepareConnectors(root) {
  const connectors = await discoverConnectors(root);
  await buildWorkspacePackage(root, '@nocoreach/connector-sdk');
  for (const connector of connectors) await buildWorkspacePackage(root, connector.name);
  const comment = '// Generated from installed direct dependencies. Run pnpm connectors:prepare; do not edit.\n';
  const imports = connectors.map((c, i) => `import connector${i} from ${JSON.stringify(`${c.name}/server`)};`).join('\n');
  await writeChanged(path.join(root, 'server/generated/connectors.ts'), `${comment}${imports}\nexport default [${connectors.map((_, i) => `connector${i}`).join(', ')}];\n`);
  const clients = connectors.filter(c => c.client);
  const clientImports = clients.map((c, i) => `import connector${i} from ${JSON.stringify(`${c.name}/client`)};`).join('\n');
  await writeChanged(path.join(root, 'client/generated/connectors.ts'), `${comment}${clientImports}\nexport default [${clients.map((_, i) => `connector${i}`).join(', ')}];\n`);
  await writeChanged(path.join(root, 'shared/generated/connectors.json'), JSON.stringify(connectors.map(({ id, name, version, client }) => ({ id, name, version, client })), null, 2) + '\n');
  return connectors;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const connectors = await prepareConnectors(root);
  console.log(`Prepared ${connectors.length} installed connector(s): ${connectors.map(c => c.id).join(', ')}`);
}
