import process from 'node:process';
// The standalone collector deliberately runs with Node alone, without installing project dependencies.
// eslint-disable-next-line vitest/no-import-node-test
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  analyzeRepository,
  parseNumstat,
  codeFigures,
  declarations,
  validRemote,
  validRef,
} from '../runner/collector.mjs';

test('rejects local paths, embedded credentials and option injection', () => {
  for (const value of [
    'file:///etc',
    '/tmp/repo',
    '--upload-pack=evil',
    'https://token@github.com/a/b',
    'git@github.com:../other',
    'https://host/a/b?token=secret',
  ])
    assert.equal(validRemote(value), false);
  for (const value of [
    'git@github.com:nocobase/nocobase.git',
    'https://github.com/nocobase/nocobase',
    'ssh://git@git.example.org/team/repo.git',
  ])
    assert.equal(validRemote(value), true);
  assert.equal(validRef('--help'), false);
  assert.equal(validRef('main..other'), false);
  assert.equal(validRef('v3-develop'), true);
});

test('handles rename records, binary files and unusual file names', () => {
  const rows = parseNumstat(
    '2\t1\tsrc/file\nname.ts\u00000\t0\t\u0000tests/a.test.ts\u0000tests/b.test.ts\u0000-\t-\timage.png\u0000',
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[1].oldPath, 'tests/a.test.ts');
  assert.equal(rows[1].path, 'tests/b.test.ts');
  assert.deepEqual(codeFigures(rows).source, { added: 2, deleted: 1 });
  assert.equal(codeFigures(rows).binaryFiles, 1);
});

test('ignores declarations in comments and strings and declines parameterized tests', () => {
  assert.deepEqual(
    declarations(
      `// test('fake')\nconst s = "it('fake')"; test('real', () => {}); it.skip('skipped', () => {});`,
    ),
    ['real', 'skipped'],
  );
  assert.equal(declarations(`test.each([1, 2])('example', () => {})`), null);
});

test('collects real Git deltas, not commit-message estimates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-report-test-'));
  const run = (args, date) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Report Test',
        GIT_COMMITTER_NAME: 'Report Test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      },
    }).trim();
  try {
    run(['init', '-b', 'main']);
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'tests'));
    await writeFile(join(root, 'src/index.ts'), 'export const old = 1;\n');
    await writeFile(join(root, 'tests/a.test.ts'), "test('old', () => {});\n");
    run(['add', '.']);
    run(['commit', '-m', 'base'], '2026-10-12T12:00:00Z');
    const base = run(['rev-parse', 'HEAD']);
    await writeFile(
      join(root, 'src/index.ts'),
      'export const current = 2;\nexport const extra = 3;\n',
    );
    await writeFile(
      join(root, 'tests/a.test.ts'),
      "test('new', () => {});\ntest('another', () => {});\n",
    );
    await writeFile(join(root, 'pnpm-lock.yaml'), 'generated: true\n');
    run(['add', '.']);
    run(['commit', '-m', 'add a feature'], '2026-10-13T12:00:00Z');
    const head = run(['rev-parse', 'HEAD']);
    const repository = {
      resourceId: 'repo',
      url: 'https://example.org/a/b',
      ref: 'main',
    };
    const material = {
      from: '2026-10-13T00:00:00Z',
      to: '2026-10-14T00:00:00Z',
      previous: [],
    };
    const facts = await analyzeRepository(
      join(root, '.git'),
      repository,
      material,
      join(root, 'details'),
    );
    assert.equal(facts.baseSha, base);
    assert.equal(facts.headSha, head);
    assert.deepEqual(facts.code.source, { added: 2, deleted: 1 });
    assert.deepEqual(facts.code.generated, { added: 1, deleted: 0 });
    assert.deepEqual(facts.tests, {
      method: 'static-declarations',
      added: 2,
      deleted: 1,
      before: 1,
      after: 2,
    });
    assert.equal(facts.commitCount, 1);
    assert.equal(facts.boundary, 'commit-time-estimate');
    const continuous = await analyzeRepository(join(root, '.git'), repository, {
      ...material,
      previous: [{ ...repository, to: material.from, headSha: base }],
    });
    assert.equal(continuous.boundary, 'previous-snapshot');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
