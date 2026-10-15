import { describe, expect, it } from 'vitest';
import {
  RunnerFacts,
  Summary,
  validateFacts,
  validateSummary,
  totals,
  type Material,
} from '../shared/api.js';
const sha = 'a'.repeat(40);
const material: Material = {
  version: 1,
  reportId: 'report',
  attemptId: 'attempt',
  projectId: 'project',
  projectName: 'Project',
  date: '2026-10-14',
  timezone: 'UTC',
  from: '2026-10-14T00:00:00.000Z',
  to: '2026-10-15T00:00:00.000Z',
  locale: 'en',
  repositories: [
    { resourceId: 'repo', url: 'https://example.com/a/b', ref: 'main' },
  ],
  issues: {
    created: 0,
    completed: 0,
    cancelled: 0,
    reopened: 0,
    items: [],
    truncated: false,
  },
  previous: [],
};
const failed = () =>
  RunnerFacts.parse({
    version: 1,
    attemptId: 'attempt',
    repositories: [
      {
        resourceId: 'repo',
        status: 'failed',
        baseSha: null,
        headSha: null,
        boundary: 'commit-time-estimate',
        code: null,
        tests: null,
        commits: [],
        commitCount: 0,
        warnings: ['failed'],
        truncated: false,
      },
    ],
  });

describe('report contract', () => {
  it('preserves unknown metrics as null', () => {
    expect(totals(failed())).toEqual({
      code: null,
      tests: null,
      estimatedTests: false,
    });
    expect(totals(null).code).toBeNull();
  });
  it('rejects stale attempts and missing or duplicate repositories', () => {
    const facts = failed();
    expect(() => validateFacts(material, facts)).not.toThrow();
    expect(() =>
      validateFacts(material, { ...facts, attemptId: 'stale' }),
    ).toThrow();
    expect(() =>
      validateFacts(material, { ...facts, repositories: [] }),
    ).toThrow();
    expect(() =>
      validateFacts(material, {
        ...facts,
        repositories: [...facts.repositories, ...facts.repositories],
      }),
    ).toThrow();
  });
  it('rejects fabricated evidence and unsupported deployment claims', () => {
    const summary = Summary.parse({
      overview: 'A change.',
      items: [
        {
          category: 'feature',
          title: 'New feature',
          description: 'A feature.',
          stage: 'on-target-branch',
          evidence: [`git:repo:${sha}`],
        },
      ],
      minorFixes: '',
    });
    expect(() => validateSummary(material, failed(), summary)).toThrow();
    expect(
      Summary.safeParse({
        ...summary,
        items: [{ ...summary.items[0], stage: 'deployed' }],
      }).success,
    ).toBe(false);
  });
  it('does not allow failed collection to contain invented numeric results', () => {
    const facts = failed();
    expect(
      RunnerFacts.safeParse({
        ...facts,
        repositories: [
          {
            ...facts.repositories[0],
            tests: {
              method: 'inventory',
              added: 1,
              deleted: 0,
              before: 0,
              after: 1,
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
