import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  if (process.argv.length !== 3) throw new Error('Usage: node apply-delivery.mjs /path/to/nocobase');
  const archive = await realpath(dirname(fileURLToPath(import.meta.url)));
  const checkout = await realpath(resolve(process.argv[2]));
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
  const sums = await readFile(join(archive, 'SHA256SUMS'), 'utf8');
  for (const line of sums.trim().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match) throw new Error('Malformed integrity manifest.');
    const [, expected, name] = match;
    const target = resolve(archive, name);
    const rel = relative(archive, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !((await lstat(target)).isFile())) throw new Error('Unsafe delivery file path.');
    const actualPath = await realpath(target);
    if (actualPath !== target) throw new Error('Delivery files must not be symlinks.');
    const actual = createHash('sha256').update(await readFile(target)).digest('hex');
    if (actual !== expected) throw new Error(`Integrity check failed: ${name}`);
  }
  const metadata = JSON.parse(await readFile(join(archive, 'delivery.json'), 'utf8'));
  const branch = 'feat/v3-project-reports';
  if (metadata.repository !== 'nocobase/nocobase' || metadata.branch !== branch || !/^[a-f0-9]{40}$/u.test(metadata.candidateCommit) || !/^[a-f0-9]{40}$/u.test(metadata.candidateTree) || !/^[a-f0-9]{40}$/u.test(metadata.expectedRemoteHead)) throw new Error('Unexpected delivery metadata.');
  if (git('branch', '--show-current') !== branch) throw new Error(`Check out the existing ${branch} branch first. No branch was created.`);
  if (git('status', '--porcelain', '--untracked-files=normal')) throw new Error('The worktree must be clean. No files were changed.');
  if (git('rev-parse', 'HEAD') !== metadata.expectedRemoteHead) throw new Error('The branch has moved. Review its changes before integrating this candidate; do not force-reset it.');
  const bundle = join(archive, 'studio-project-reports.bundle');
  git('bundle', 'verify', bundle);
  git('fetch', bundle, `refs/heads/${branch}`);
  if (git('rev-parse', 'FETCH_HEAD') !== metadata.candidateCommit) throw new Error('The bundle names an unexpected commit.');
  if (git('rev-parse', `${metadata.candidateCommit}^{tree}`) !== metadata.candidateTree) throw new Error('The bundle tree does not match the tested tree.');
  if (git('rev-parse', `${metadata.candidateCommit}^`) !== metadata.expectedRemoteHead) throw new Error('The bundle is not a direct descendant of the expected existing branch.');
  if (git('diff', '--name-only', metadata.baseCommit, metadata.candidateCommit, '--', '.github/workflows')) throw new Error('The candidate unexpectedly changes workflows.');
  git('merge', '--ff-only', '--no-edit', metadata.candidateCommit);
  console.log(`Applied verified tree ${metadata.candidateTree} to ${branch}.`);
  console.log('No remote push or pull request was performed. Review the diff and publish with your ordinary Git credentials.');
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Delivery failed.'); process.exitCode = 1; });
