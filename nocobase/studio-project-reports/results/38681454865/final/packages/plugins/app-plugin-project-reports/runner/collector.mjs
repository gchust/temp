import process from 'node:process';
import { URL } from 'node:url';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BUFFER = 64 * 1024 * 1024;
const TEST_FILE =
  /(?:^|\/)(?:__tests__\/.*|[^/]+\.(?:test|spec))\.[cm]?[jt]sx?$/u;
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;

export function validRemote(remote) {
  if (
    typeof remote !== 'string' ||
    remote.length > 2048 ||
    /\s/u.test(remote) ||
    Array.from(remote).some((char) => char.charCodeAt(0) < 32)
  )
    return false;
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+$/u.test(remote))
    return !remote.split(':')[1].split('/').includes('..');
  try {
    const url = new URL(remote);
    return (
      ['https:', 'ssh:'].includes(url.protocol) &&
      !!url.hostname &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'ssh:'
        ? /^[A-Za-z0-9._-]*$/u.test(url.username)
        : !url.username) &&
      /^\/[A-Za-z0-9._/-]+$/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function validRef(ref) {
  return (
    ref === null ||
    (typeof ref === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(ref) &&
      !ref.includes('..') &&
      !ref.includes('//'))
  );
}

function git(directory, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'protocol.file.allow=never',
        ...(directory ? ['--git-dir', directory] : []),
        ...args,
      ],
      {
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: MAX_BUFFER,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' },
        ...options,
      },
      (error, stdout) =>
        error ? reject(new Error('GIT_COMMAND_FAILED')) : resolve(stdout),
    );
    child.stdin?.end(options.input ?? '');
  });
}

export function category(path) {
  if (
    /(?:^|\/)(?:node_modules|dist|build|coverage|vendor)(?:\/|$)|(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)|\.(?:snap|map|min\.js)$/u.test(
      path,
    )
  )
    return 'generated';
  if (TEST_FILE.test(path) || /(?:^|\/)(?:tests?|e2e)(?:\/|$)/u.test(path))
    return 'tests';
  if (/(?:^|\/)(?:docs?|\.changeset)(?:\/|$)|\.(?:md|mdx|rst|txt)$/u.test(path))
    return 'documentation';
  if (
    /\.(?:json|ya?ml|toml|ini|conf)$/u.test(path) ||
    /(?:^|\/)(?:Dockerfile|\.github)(?:\/|$)|(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/u.test(
      path,
    )
  )
    return 'configuration';
  return 'source';
}

export function parseNumstat(text) {
  const parts = text.split('\0');
  const result = [];
  for (let index = 0; index < parts.length; index++) {
    const row = parts[index];
    if (!row) continue;
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/u.exec(row);
    if (!match) throw new Error('INVALID_NUMSTAT');
    let oldPath = match[3];
    let path = oldPath;
    if (path === '') {
      oldPath = parts[++index];
      path = parts[++index];
      if (!oldPath || !path) throw new Error('INVALID_NUMSTAT');
    }
    const binary = match[1] === '-' || match[2] === '-';
    result.push({
      oldPath,
      path,
      binary,
      added: binary ? 0 : Number(match[1]),
      deleted: binary ? 0 : Number(match[2]),
    });
  }
  return result;
}

export function codeFigures(rows) {
  const result = Object.fromEntries(
    ['source', 'tests', 'documentation', 'configuration', 'generated'].map(
      (key) => [key, { added: 0, deleted: 0 }],
    ),
  );
  result.files = rows.length;
  result.binaryFiles = rows.filter((row) => row.binary).length;
  for (const row of rows) {
    result[category(row.path)].added += row.added;
    result[category(row.oldPath)].deleted += row.deleted;
  }
  return result;
}

/** A small lexer, not an execution engine. Counts declarations only, and never calls project code. */
export function declarations(source) {
  const tokens = [];
  for (let i = 0; i < source.length;) {
    if (/\s/u.test(source[i])) {
      i++;
      continue;
    }
    if (source.slice(i, i + 2) === '//') {
      i = source.indexOf('\n', i + 2);
      if (i < 0) break;
      continue;
    }
    if (source.slice(i, i + 2) === '/*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    const char = source[i];
    if (char === '"' || char === "'" || char === '`') {
      let value = '';
      let dynamic = false;
      const quote = char;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          value += source.slice(i, i + 2);
          i += 2;
        } else {
          if (quote === '`' && source.slice(i, i + 2) === '${') dynamic = true;
          value += source[i++];
        }
      }
      if (i >= source.length) return null;
      i++;
      tokens.push({ kind: dynamic ? 'dynamic' : 'string', value });
      continue;
    }
    const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/u.exec(source.slice(i));
    if (identifier) {
      tokens.push({ kind: 'id', value: identifier[0] });
      i += identifier[0].length;
    } else {
      tokens.push({ kind: 'symbol', value: char });
      i++;
    }
  }
  const names = [];
  for (let index = 0; index < tokens.length; index++) {
    if (
      tokens[index].kind !== 'id' ||
      !['it', 'test'].includes(tokens[index].value)
    )
      continue;
    if (tokens[index - 1]?.value === '.') continue;
    let at = index + 1;
    while (tokens[at]?.value === '.' && tokens[at + 1]?.kind === 'id') {
      if (tokens[at + 1].value === 'each') return null;
      if (
        !['only', 'skip', 'todo', 'concurrent', 'sequential', 'fails'].includes(
          tokens[at + 1].value,
        )
      )
        break;
      at += 2;
    }
    if (tokens[at]?.value !== '(') continue;
    if (tokens[at + 1]?.kind !== 'string') return null;
    names.push(tokens[at + 1].value);
  }
  return names;
}

function difference(before, after) {
  const counts = (items) => {
    const map = new Map();
    for (const item of items) map.set(item, (map.get(item) ?? 0) + 1);
    return map;
  };
  const left = counts(before);
  const right = counts(after);
  let added = 0;
  let deleted = 0;
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const delta = (right.get(key) ?? 0) - (left.get(key) ?? 0);
    added += Math.max(0, delta);
    deleted += Math.max(0, -delta);
  }
  return { added, deleted, before: before.length, after: after.length };
}

async function testInventory(directory, sha, renames) {
  if (!sha) return { method: 'empty', tests: [] };
  const paths = (
    await git(directory, ['ls-tree', '-r', '--name-only', '-z', sha])
  )
    .split('\0')
    .filter(Boolean);
  if (paths.includes('.nocobase/report-tests.json')) {
    const input = JSON.parse(
      await git(directory, ['show', `${sha}:.nocobase/report-tests.json`]),
    );
    if (
      input.version !== 1 ||
      typeof input.suite !== 'string' ||
      !Array.isArray(input.tests) ||
      input.tests.length > 100_000 ||
      input.tests.some((item) => typeof item !== 'string') ||
      new Set(input.tests).size !== input.tests.length
    )
      return null;
    return { method: 'inventory', suite: input.suite, tests: input.tests };
  }
  const files = paths.filter(
    (path) =>
      TEST_FILE.test(path) &&
      !/(?:^|\/)(?:node_modules|vendor|dist)\//u.test(path),
  );
  if (files.length === 0) return { method: 'empty', tests: [] };
  if (files.length > 2000) return null;
  const tests = [];
  for (const path of files) {
    const source = await git(directory, ['show', `${sha}:${path}`], {
      maxBuffer: 512 * 1024,
    });
    const names = declarations(source);
    if (names === null) return null;
    const name = renames.get(path) ?? path;
    tests.push(...names.map((title) => `${name}\0${title}`));
  }
  return { method: 'static-declarations', tests };
}

async function testsBetween(directory, base, head, rows) {
  const renames = new Map(
    rows
      .filter((row) => row.oldPath !== row.path)
      .map((row) => [row.oldPath, row.path]),
  );
  try {
    const before = await testInventory(directory, base, renames);
    const after = await testInventory(directory, head, new Map());
    if (!before || !after) return null;
    if (
      before.method !== 'empty' &&
      after.method !== 'empty' &&
      (before.method !== after.method || before.suite !== after.suite)
    )
      return null;
    const method = after.method === 'empty' ? before.method : after.method;
    if (method === 'empty') return null;
    return { method, ...difference(before.tests, after.tests) };
  } catch {
    return null;
  }
}

/** Analyze an already isolated bare repository; the CLI below performs only remote, credential-free-in-URL clones. */
export async function analyzeRepository(
  directory,
  repository,
  material,
  detailsDirectory,
) {
  const ref = repository.ref ?? 'HEAD';
  await git(directory, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${ref}^{commit}`,
  ]);
  const before = async (at) =>
    (
      await git(directory, [
        'rev-list',
        '--first-parent',
        '--max-count=1',
        `--before=${new Date(Date.parse(at) - 1).toISOString()}`,
        ref,
        '--',
      ])
    ).trim() || null;
  const headSha = await before(material.to);
  const previous = material.previous?.find(
    (item) =>
      item.resourceId === repository.resourceId &&
      item.url === repository.url &&
      item.ref === repository.ref &&
      item.to === material.from,
  );
  const baseSha = previous ? previous.headSha : await before(material.from);
  if ((baseSha && !SHA.test(baseSha)) || (headSha && !SHA.test(headSha)))
    throw new Error('INVALID_BOUNDARY');
  if (baseSha && headSha)
    await git(directory, ['merge-base', '--is-ancestor', baseSha, headSha]);
  if (baseSha && !headSha) throw new Error('HISTORY_REWRITTEN');
  const empty = (
    await git(directory, ['hash-object', '-t', 'tree', '--stdin'], {
      input: '',
    })
  ).trim();
  const left = baseSha ?? empty;
  const right = headSha ?? empty;
  const rows = parseNumstat(
    await git(directory, [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--numstat',
      '-z',
      '-M',
      left,
      right,
      '--',
    ]),
  );
  const commitArgs = headSha
    ? [baseSha ? `${baseSha}..${headSha}` : headSha]
    : [];
  const commitCount = headSha
    ? Number(
        (
          await git(directory, [
            'rev-list',
            '--count',
            '--first-parent',
            ...commitArgs,
            '--',
          ])
        ).trim(),
      )
    : 0;
  const lines = headSha
    ? (
        await git(directory, [
          'log',
          '--first-parent',
          '--max-count=500',
          '--format=%H%x00%s',
          ...commitArgs,
          '--',
        ])
      )
        .trim()
        .split('\n')
        .filter(Boolean)
    : [];
  const commits = lines.map((line) => {
    const [sha, ...title] = line.split('\0');
    return { sha, title: title.join(' ').slice(0, 1000) };
  });
  const warnings = previous ? [] : ['commit-time-boundaries-not-push-times'];
  const tests = await testsBetween(directory, baseSha, headSha, rows);
  if (!tests) warnings.push('test-inventory-unavailable');
  else if (tests.method === 'static-declarations')
    warnings.push('test-declarations-estimated-not-executed-cases');
  let truncated = commitCount > commits.length;
  if (detailsDirectory) {
    await mkdir(detailsDirectory, { recursive: true });
    const paths = rows
      .filter((row) => !row.binary && category(row.path) !== 'generated')
      .slice(0, 200)
      .map((row) => row.path);
    let patch = '';
    if (paths.length) {
      try {
        patch = await git(
          directory,
          [
            'diff',
            '--no-ext-diff',
            '--no-textconv',
            '--unified=3',
            left,
            right,
            '--',
            ...paths,
          ],
          { maxBuffer: 8 * 1024 * 1024 },
        );
      } catch {
        warnings.push('patch-too-large');
        truncated = true;
      }
    }
    if (patch.length > 200_000 || rows.length > 200) truncated = true;
    await writeFile(
      join(detailsDirectory, 'changes.diff'),
      patch.slice(0, 200_000),
    );
    await writeFile(
      join(detailsDirectory, 'files.json'),
      JSON.stringify(rows.slice(0, 200), null, 2),
    );
  }
  return {
    resourceId: repository.resourceId,
    status: 'ok',
    baseSha,
    headSha,
    boundary: previous ? 'previous-snapshot' : 'commit-time-estimate',
    code: codeFigures(rows),
    tests,
    commits,
    commitCount,
    warnings,
    truncated,
  };
}

export async function collect(material, outputDirectory) {
  if (
    material.version !== 1 ||
    !Array.isArray(material.repositories) ||
    material.repositories.length > 20 ||
    !Number.isFinite(Date.parse(material.from)) ||
    !Number.isFinite(Date.parse(material.to)) ||
    Date.parse(material.from) >= Date.parse(material.to)
  )
    throw new Error('INVALID_MATERIAL');
  const repositories = [];
  for (const [index, repository] of material.repositories.entries()) {
    let workspace;
    try {
      if (!validRemote(repository.url) || !validRef(repository.ref))
        throw new Error('INVALID_REPOSITORY');
      workspace = await mkdtemp(join(tmpdir(), 'project-report-'));
      const directory = join(workspace, 'repository.git');
      await git(null, [
        'clone',
        '--bare',
        '--no-hardlinks',
        '--',
        repository.url,
        directory,
      ]);
      repositories.push(
        await analyzeRepository(
          directory,
          repository,
          material,
          join(outputDirectory, `repository-${index + 1}`),
        ),
      );
    } catch {
      repositories.push({
        resourceId: repository.resourceId,
        status: 'failed',
        baseSha: null,
        headSha: null,
        boundary: 'commit-time-estimate',
        code: null,
        tests: null,
        commits: [],
        commitCount: 0,
        warnings: [
          'repository-collection-failed-check-runner-access-and-history',
        ],
        truncated: false,
      });
    } finally {
      if (workspace) await rm(workspace, { recursive: true, force: true });
    }
  }
  return { version: 1, attemptId: material.attemptId, repositories };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [input, output = 'facts.json'] = process.argv.slice(2);
  if (!input)
    throw new Error('Usage: node collector.mjs material.json [facts.json]');
  const material = JSON.parse(await readFile(input, 'utf8'));
  const facts = await collect(material, resolve('report-details'));
  await writeFile(output, JSON.stringify(facts, null, 2));
}
