import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const source = resolve(process.argv[2] ?? 'source');
const evidence = resolve(process.argv[3] ?? 'evidence');
const destination = resolve(process.argv[4] ?? 'delivery');
const base = '98b386237a9fabcb7a86c47b4a46c4980c1d3e13';
const expectedHead = 'f5264d1aa0b2365ac4cafc0040386fa1912e1d02';
const branch = 'feat/v3-project-reports';
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const originalHead = git('rev-parse', 'HEAD');
if (originalHead !== base) throw new Error('The verification source must be the pinned base.');
const checks = await readFile(join(evidence, 'check-exit-codes.txt'), 'utf8');
const required = ['format', 'typecheck', 'test', 'build', 'lint', 'projects-typecheck', 'projects-tests', 'agents-typecheck', 'agents-tests', 'studio-typecheck', 'studio-build', 'chromium', 'browser', 'changesets', 'peers', 'runtime-deps', 'cli-reference', 'openapi', 'frozen-lockfile'];
for (const name of required) if (!checks.split('\n').includes(`${name}=0`)) throw new Error(`Cannot package an unverified candidate: ${name}`);
const paths = git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean);
if (!paths.length || paths.some((path) => path.startsWith('.github/workflows/'))) throw new Error('The candidate must contain feature changes and no workflow edits.');
await mkdir(destination, { recursive: true });
await cp(join(evidence, 'final'), join(destination, 'changed-files'), { recursive: true });
await cp(join(evidence, 'changes.patch'), join(destination, 'changes-from-base.patch'));
await cp(join(evidence, 'diff-stat.log'), join(destination, 'diff-stat.txt'));
await cp(join(evidence, 'check-exit-codes.txt'), join(destination, 'verification.txt'));
await mkdir(join(destination, 'logs'), { recursive: true });
for (const entry of await readdir(evidence, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.log')) await cp(join(evidence, entry.name), join(destination, 'logs', entry.name));
}

// Include just test screenshots, never browser traces, installed fonts, dependencies or app databases.
async function collectScreenshots(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collectScreenshots(path);
    else if (entry.isFile() && /^project-reports-(desktop|mobile)\.png$/u.test(entry.name)) {
      await mkdir(join(destination, 'screenshots'), { recursive: true });
      await cp(path, join(destination, 'screenshots', entry.name));
    }
  }
}
await collectScreenshots(join(source, 'packages/apps/studio/test-results'));
const candidateTree = git('write-tree');
if (candidateTree !== (await readFile(join(evidence, 'candidate-tree.txt'), 'utf8')).trim()) throw new Error('The staged candidate changed after evidence export.');

// Fetch public source only. No credential is obtained or passed to the delivery bundle.
git('fetch', '--no-tags', 'https://github.com/nocobase/nocobase.git', branch);
const actualHead = git('rev-parse', 'FETCH_HEAD');
if (actualHead !== expectedHead) throw new Error('The source branch moved. Review it before packaging a fast-forward delivery.');
const env = { ...process.env, GIT_AUTHOR_NAME: 'Project reports delivery', GIT_AUTHOR_EMAIL: 'project-reports@example.invalid', GIT_COMMITTER_NAME: 'Project reports delivery', GIT_COMMITTER_EMAIL: 'project-reports@example.invalid' };
const candidate = execFileSync('git', ['-C', source, 'commit-tree', candidateTree, '-p', expectedHead, '-m', 'feat(project-reports): integrate verified daily reports with Studio'], { encoding: 'utf8', env }).trim();
// Local artifact ref only; this script never pushes any repository or creates a remote branch.
git('update-ref', `refs/heads/${branch}`, candidate);
git('bundle', 'create', join(destination, 'studio-project-reports.bundle'), `refs/heads/${branch}`, `^${base}`);
git('bundle', 'verify', join(destination, 'studio-project-reports.bundle'));
await writeFile(join(destination, 'changes-from-existing-branch.patch'), execFileSync('git', ['-C', source, 'diff', '--binary', expectedHead, candidate], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
if (git('diff', '--name-only', base, candidate, '--', '.github/workflows')) throw new Error('A source workflow changed.');
if (git('rev-parse', `${candidate}^{tree}`) !== candidateTree) throw new Error('The bundle does not contain the verified source tree.');

const metadata = {
  repository: 'nocobase/nocobase', branch, baseCommit: base, expectedRemoteHead: expectedHead,
  candidateCommit: candidate, candidateTree,
  verificationRun: process.env.GITHUB_RUN_ID,
  verificationToolingCommit: process.env.GITHUB_SHA,
  sourceBranchUpdated: false, pullRequestCreated: false,
  verification: 'Scoped checks and Chromium end-to-end test passed for this tree. Runner publication used a protocol fixture; collector tests used real local Git histories.',
};
await writeFile(join(destination, 'delivery.json'), JSON.stringify(metadata, null, 2) + '\n');
const here = dirname(new URL(import.meta.url).pathname);
await cp(join(here, 'review-delivery.md'), join(destination, 'REVIEW.md'));
await cp(join(here, 'apply-delivery.mjs'), join(destination, 'apply-delivery.mjs'));
await writeFile(join(destination, 'README.md'), `# Studio project reports — verified candidate\n\nThis archive contains the verified source changes, not a claim that the source repository has been updated. The only remote implementation branch remains the earlier WIP at ${expectedHead}. No pull request was created.\n\nBase: ${base}. Candidate tree: ${candidateTree}. Candidate commit in the bundle: ${candidate}.\n\n## Apply to the existing branch\n\nUse your ordinary checkout and credentials. The helper verifies archive hashes, a clean worktree, the exact existing branch and its expected WIP head. It imports the bundle and fast-forwards locally; it does not push, create another branch or open a pull request.\n\n\`\`\`sh\nnode /path/to/unpacked-delivery/apply-delivery.mjs /path/to/nocobase\n# Inspect the local changes and run your normal checks before publishing.\ngit -C /path/to/nocobase push origin feat/v3-project-reports\n\`\`\`\n\nThe helper deliberately refuses a checkout whose branch has moved. Do not force-reset it; review and integrate its changes instead. The bundle requires the original base commit, already present in a checkout of the WIP branch.\n\n## Contents\n\n\`changed-files/\` contains the final contents of changed source files, the synchronized lockfile, changesets and generated CLI documentation. \`changes-from-base.patch\` applies to the pinned base. \`changes-from-existing-branch.patch\` applies to the exact WIP head and removes superseded WIP files. Do not blindly copy changed-files over the WIP directory, because copying alone leaves removed WIP files behind. \`studio-project-reports.bundle\` contains the complete tested tree as a fast-forward commit on the one existing branch. Logs, verification results, screenshots and review findings accompany it.\n\nNo source workflows, dependencies, browser traces, font files, runtime databases or credentials are included.\n`);
const hashes = [];
async function files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await files(path);
    else if (entry.isFile()) {
      if (/\.(woff2?|ttf|otf|eot)$/iu.test(entry.name)) throw new Error('Font files must not be included in delivery.');
      hashes.push(`${createHash('sha256').update(await readFile(path)).digest('hex')}  ${relative(destination, path).split('\\').join('/')}`);
    } else throw new Error('The delivery must not contain symlinks.');
  }
}
await files(destination);
await writeFile(join(destination, 'SHA256SUMS'), hashes.sort().join('\n') + '\n');
console.log(JSON.stringify(metadata, null, 2));
