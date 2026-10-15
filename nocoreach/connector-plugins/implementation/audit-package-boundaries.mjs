import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const ts = createRequire(path.join(root, 'package.json'))('typescript');
const failures = [];
const checked = [];
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : /\.(ts|tsx|mjs)$/.test(entry.name) ? [file] : [];
  });
}
for (const entry of readdirSync(path.join(root, 'app-plugins'), { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('connector-')) continue;
  const directory = path.join(root, 'app-plugins', entry.name);
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const sources = files(directory);
  for (const file of sources) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function inspect(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        if (specifier.startsWith('.')) {
          const target = path.resolve(path.dirname(file), specifier);
          const relative = path.relative(directory, target);
          if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) failures.push(`${path.relative(root, file)} escapes its npm package: ${specifier}`);
          const candidates = [target, target.replace(/\.js$/, '.ts'), target.replace(/\.js$/, '.tsx'), target + '.ts', target + '.tsx', path.join(target, 'index.ts')];
          if (!candidates.some(candidate => existsSync(candidate) && statSync(candidate).isFile())) failures.push(`${path.relative(root, file)} cannot resolve ${specifier}`);
        }
        if (specifier.startsWith('#')) failures.push(`${path.relative(root, file)} imports application alias ${specifier}`);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
  checked.push({ packageName: manifest.name, files: sources.length });
}
const report = { checked, failures };
const output = path.resolve(root, '..', 'artifacts');
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, 'package-boundary-report.json'), JSON.stringify(report, null, 2));
console.log('PACKAGE_BOUNDARY_AUDIT', JSON.stringify(report));
if (failures.length) throw new Error('Connector package boundary audit failed:\n' + failures.join('\n'));
