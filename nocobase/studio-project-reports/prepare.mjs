import { cp, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const root = resolve(process.argv[2] ?? 'source');
const here = dirname(new URL(import.meta.url).pathname);
// Start with the candidate that passed package checks and the Studio production build.
await cp(resolve(here, 'results/38683264920/final'), root, { recursive: true });
const settings = resolve(root, 'packages/plugins/app-plugin-project-reports/client/settings.tsx');
let source = await readFile(settings, 'utf8');
source = source
  .replace("<select\n            required={value.enabled}", "<select\n            aria-label={t('agent')}\n            required={value.enabled}")
  .replace("<Input\n            value={value.timezone}", "<Input\n            aria-label={t('timezone')}\n            value={value.timezone}")
  .replace("<Input\n            type='number'", "<Input\n            aria-label={t('hour')}\n            type='number'")
  .replace("<select\n            className={selectClass}\n            value={value.locale}", "<select\n            aria-label={t('language')}\n            className={selectClass}\n            value={value.locale}");
await writeFile(settings, source);
const collector = resolve(root, 'packages/plugins/app-plugin-project-reports/runner/collector.mjs');
source = await readFile(collector, 'utf8');
source = source.replace("'git',\n      [", "'git',\n      [\n        '--literal-pathspecs',");
await writeFile(collector, source);
