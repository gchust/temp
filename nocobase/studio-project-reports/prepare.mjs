import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import process from 'node:process';
const root = resolve(process.argv[2] ?? 'source');
const here = dirname(new URL(import.meta.url).pathname);
execFileSync(process.execPath, [resolve(here, 'apply.mjs'), root], { stdio: 'inherit' });
if (process.env.REPORTS_PHASE === 'full') {
  for (const script of ['review-fixes.mjs', 'compile-fixes.mjs', 'next-pass.mjs', 'browser-patches.mjs', 'declaration-fixes.mjs']) execFileSync(process.execPath, [resolve(here, script), root], { stdio: 'inherit' });
  const path = resolve(root, 'packages/apps/studio/e2e/project-reports.test.ts');
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace("page.evaluate(() => document.documentElement.classList.add('dark'))", "page.evaluate(\"document.documentElement.classList.add('dark')\")"));
}
