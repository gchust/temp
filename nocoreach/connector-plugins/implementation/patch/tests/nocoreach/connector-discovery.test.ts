import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverConnectors, prepareConnectors } from '../../cli/prepare-connectors.mjs';

const roots: string[] = [];
async function application(dependencies: Record<string, string> = {}, devDependencies: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'nr-connector-discovery-'));
  roots.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'test-host', type: 'module', dependencies, devDependencies }));
  return root;
}
async function installed(root: string, name: string, id: string, overrides: Record<string, unknown> = {}) {
  const directory = path.join(root, 'node_modules', name);
  await mkdir(directory, { recursive: true });
  const metadata = { name, version: '1.0.0', type: 'module', exports: { './package.json': './package.json', './server': './server.js' }, nocoreach: { connector: { id, apiVersion: 1 } }, ...overrides };
  await writeFile(path.join(directory, 'package.json'), JSON.stringify(metadata));
  // Discovery must not evaluate the module even if it exists and is executable.
  await writeFile(path.join(directory, 'server.js'), "throw new Error('Connector discovery evaluated package code');\n");
  return directory;
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('installed npm connector discovery', () => {
  it('accepts an explicitly marked direct third-party dependency without executing it', async () => {
    const root = await application({ '@acme/marketing': '1.0.0' });
    await installed(root, '@acme/marketing', 'acme');
    expect((await discoverConnectors(root)).map(connector => connector.id)).toEqual(['acme']);
  });

  it('does not enable a package only because it exists in node_modules', async () => {
    const root = await application();
    await installed(root, '@acme/transitive', 'transitive');
    expect(await discoverConnectors(root)).toEqual([]);
  });

  it('does not implicitly enable a development dependency', async () => {
    const root = await application({}, { '@acme/dev-fixture': '1.0.0' });
    await installed(root, '@acme/dev-fixture', 'dev-fixture');
    expect(await discoverConnectors(root)).toEqual([]);
  });

  it('ignores direct dependencies without the connector declaration', async () => {
    const root = await application({ utility: '1.0.0' });
    await installed(root, 'utility', 'ignored', { nocoreach: undefined });
    expect(await discoverConnectors(root)).toEqual([]);
  });

  it('rejects a duplicate connector ID with different npm packages', async () => {
    const root = await application({ '@acme/one': '1.0.0', '@acme/two': '1.0.0' });
    await installed(root, '@acme/one', 'same');
    await installed(root, '@acme/two', 'same');
    await expect(discoverConnectors(root)).rejects.toThrow('Duplicate connector ID');
  });

  it('rejects an unsupported connector API version', async () => {
    const root = await application({ '@acme/one': '1.0.0' });
    await installed(root, '@acme/one', 'one', { nocoreach: { connector: { id: 'one', apiVersion: 2 } } });
    await expect(discoverConnectors(root)).rejects.toThrow('Invalid connector manifest');
  });

  it('rejects a declared client contribution without an export', async () => {
    const root = await application({ '@acme/one': '1.0.0' });
    await installed(root, '@acme/one', 'one', { nocoreach: { connector: { id: 'one', apiVersion: 1, client: true } } });
    await expect(discoverConnectors(root)).rejects.toThrow('Missing client export');
  });

  it('rejects a marked package without a server export', async () => {
    const root = await application({ '@acme/one': '1.0.0' });
    await installed(root, '@acme/one', 'one', { exports: { './package.json': './package.json' } });
    await expect(discoverConnectors(root)).rejects.toThrow('Missing server export');
  });

  it('requires an explicit first-party connector dependency to actually be installed', async () => {
    const root = await application({ '@nocoreach/connector-missing': '1.0.0' });
    await expect(discoverConnectors(root)).rejects.toThrow('Connector must export package.json');
  });

  it('regenerates composition after removing a dependency, even if its files remain', async () => {
    const root = await application({ '@acme/one': '1.0.0' });
    await installed(root, '@acme/one', 'one');
    await prepareConnectors(root);
    const generated = path.join(root, 'server/generated/connectors.ts');
    expect(await readFile(generated, 'utf8')).toContain('@acme/one/server');
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'test-host', dependencies: {} }));
    await prepareConnectors(root);
    expect(await readFile(generated, 'utf8')).not.toContain('@acme/one');
    expect(JSON.parse(await readFile(path.join(root, 'shared/generated/connectors.json'), 'utf8'))).toEqual([]);
  });

  it('writes matching deterministic server and client composition', async () => {
    const root = await application({ '@acme/one': '1.0.0' });
    await installed(root, '@acme/one', 'one', { exports: { './package.json': './package.json', './server': './server.js', './client': './client.js' }, nocoreach: { connector: { id: 'one', apiVersion: 1, client: true } } });
    await prepareConnectors(root);
    expect(await readFile(path.join(root, 'server/generated/connectors.ts'), 'utf8')).toContain('@acme/one/server');
    expect(await readFile(path.join(root, 'client/generated/connectors.ts'), 'utf8')).toContain('@acme/one/client');
    const before = await readFile(path.join(root, 'shared/generated/connectors.json'), 'utf8');
    await prepareConnectors(root);
    expect(await readFile(path.join(root, 'shared/generated/connectors.json'), 'utf8')).toEqual(before);
  });
});
