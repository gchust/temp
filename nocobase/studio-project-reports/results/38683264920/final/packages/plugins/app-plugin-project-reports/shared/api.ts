import type {
  RepositorySpec as RepositorySpecData,
  IssueFact as IssueFactData,
  IssueFacts as IssueFactsData,
  Material as MaterialData,
  Delta as DeltaData,
  CodeFigures as CodeFiguresData,
  TestFigures as TestFiguresData,
  CommitFact as CommitFactData,
  RepositoryFacts as RepositoryFactsData,
  RunnerFacts as RunnerFactsData,
  SummaryItem as SummaryItemData,
  Summary as SummaryData,
} from './contracts.js';
import { z } from 'zod';
import { isDay, isTimezone } from './dates.js';

export const PACKAGE = '@nocobase/app-plugin-project-reports';
export const SUBJECT = 'project-report';
export const REPORTER = 'project-reports-writer';
export const REPORT_PATH = '/project-reports';
export const REPORT_API = '/api/project-reports';
export const Count: z.ZodNumber = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
export const Day: z.ZodString = z
  .string()
  .refine(isDay, 'A real calendar date, YYYY-MM-DD.');
export const Timezone: z.ZodString = z
  .string()
  .refine(isTimezone, 'An IANA timezone.');
const Id = z.string().min(1).max(128);
export const Sha: z.ZodString = z
  .string()
  .regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u);
export const SettingsInput: z.ZodObject<
  {
    enabled: z.ZodBoolean;
    agentId: z.ZodNullable<z.ZodString>;
    timezone: z.ZodString;
    hour: z.ZodNumber;
    locale: z.ZodEnum<{ en: 'en'; 'zh-CN': 'zh-CN' }>;
    expectedRevision: z.ZodNumber;
  },
  z.core.$strict
> = z.strictObject({
  enabled: z.boolean(),
  agentId: Id.nullable(),
  timezone: Timezone,
  hour: z.number().int().min(0).max(23),
  locale: z.enum(['en', 'zh-CN']),
  expectedRevision: Count,
});
export type SettingsInput = z.infer<typeof SettingsInput>;
export interface Settings extends Omit<SettingsInput, 'expectedRevision'> {
  projectId: string;
  actorUserId: string;
  revision: number;
}
export const defaultSettings = (): Omit<
  Settings,
  'projectId' | 'actorUserId' | 'revision'
> => ({
  enabled: false,
  agentId: null,
  timezone: 'UTC',
  hour: 2,
  locale: 'en',
});
export const RepositorySpec: z.ZodType<RepositorySpecData> = z.strictObject({
  resourceId: Id,
  url: z.string().min(1).max(2048),
  ref: z.string().max(200).nullable(),
});
export type RepositorySpec = RepositorySpecData;
export const IssueFact: z.ZodType<IssueFactData> = z.strictObject({
  id: Id,
  identifier: z.string().max(128),
  title: z.string().max(1000),
  created: z.boolean(),
  completed: z.boolean(),
  cancelled: z.boolean(),
  reopened: z.boolean(),
});
export const IssueFacts: z.ZodType<IssueFactsData> = z.strictObject({
  created: Count,
  completed: Count,
  cancelled: Count,
  reopened: Count,
  items: z.array(IssueFact).max(300),
  truncated: z.boolean(),
});
export type IssueFacts = IssueFactsData;
export const Material: z.ZodType<MaterialData> = z.strictObject({
  version: z.literal(1),
  reportId: Id,
  attemptId: Id,
  projectId: Id,
  projectName: z.string().max(255),
  date: Day,
  timezone: Timezone,
  from: z.string().datetime(),
  to: z.string().datetime(),
  locale: z.enum(['en', 'zh-CN']),
  repositories: z.array(RepositorySpec).max(20),
  issues: IssueFacts,
  previous: z
    .array(
      z.strictObject({
        resourceId: Id,
        url: z.string(),
        ref: z.string().nullable(),
        to: z.string().datetime(),
        headSha: Sha.nullable(),
      }),
    )
    .max(20),
});
export type Material = MaterialData;
export const Delta: z.ZodType<DeltaData> = z.strictObject({
  added: Count,
  deleted: Count,
});
export type Delta = DeltaData;
export const CodeFigures: z.ZodType<CodeFiguresData> = z.strictObject({
  source: Delta,
  tests: Delta,
  documentation: Delta,
  configuration: Delta,
  generated: Delta,
  files: Count,
  binaryFiles: Count,
});
export const TestFigures: z.ZodType<TestFiguresData> = z
  .strictObject({
    method: z.enum(['inventory', 'static-declarations']),
    added: Count,
    deleted: Count,
    before: Count,
    after: Count,
  })
  .refine(
    (value) => value.after - value.before === value.added - value.deleted,
    'Test totals and deltas must reconcile.',
  );
export const CommitFact: z.ZodType<CommitFactData> = z.strictObject({
  sha: Sha,
  title: z.string().max(1000),
});
export const RepositoryFacts: z.ZodType<RepositoryFactsData> = z
  .strictObject({
    resourceId: Id,
    status: z.enum(['ok', 'failed']),
    baseSha: Sha.nullable(),
    headSha: Sha.nullable(),
    boundary: z.enum(['previous-snapshot', 'commit-time-estimate']),
    code: CodeFigures.nullable(),
    tests: TestFigures.nullable(),
    commits: z.array(CommitFact).max(500),
    commitCount: Count,
    warnings: z.array(z.string().max(200)).max(30),
    truncated: z.boolean(),
  })
  .superRefine((value, context) => {
    if (
      value.status === 'failed' &&
      (value.code !== null || value.tests !== null)
    )
      context.addIssue({
        code: 'custom',
        message: 'Failed collection has no numeric result.',
      });
    if (value.status === 'ok' && value.code === null)
      context.addIssue({
        code: 'custom',
        message: 'Successful collection needs code figures.',
      });
    if (
      value.status === 'failed' &&
      (value.commitCount !== 0 ||
        value.commits.length !== 0 ||
        value.baseSha !== null ||
        value.headSha !== null)
    )
      context.addIssue({
        code: 'custom',
        message: 'Failed collection cannot assert commit facts.',
      });
    if (
      new Set(value.commits.map((commit) => commit.sha)).size !==
      value.commits.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Commit evidence must be unique.',
      });
    if (value.commits.length > value.commitCount)
      context.addIssue({
        code: 'custom',
        message: 'Commit inventory exceeds its total.',
      });
  });
export const RunnerFacts: z.ZodType<RunnerFactsData> = z.strictObject({
  version: z.literal(1),
  attemptId: Id,
  repositories: z.array(RepositoryFacts).max(20),
});
export type RunnerFacts = RunnerFactsData;
export const SummaryItem: z.ZodType<SummaryItemData> = z.strictObject({
  category: z.enum([
    'feature',
    'architecture',
    'critical-fix',
    'fix',
    'maintenance',
    'risk',
  ]),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(1200),
  stage: z.enum([
    'on-target-branch',
    'in-progress',
    'resolved',
    'unresolved',
    'unknown',
  ]),
  evidence: z.array(z.string().max(300)).min(1).max(20),
});
export const Summary: z.ZodType<SummaryData> = z.strictObject({
  overview: z.string().trim().min(1).max(1200),
  items: z.array(SummaryItem).max(12),
  minorFixes: z.string().max(1200),
});
export type Summary = SummaryData;
export type ReportStatus = 'generating' | 'ready' | 'partial' | 'failed';
export interface ReportView {
  id: string;
  projectId: string;
  projectName: string;
  date: string;
  timezone: string;
  status: ReportStatus;
  currentAttemptId: string;
  publishedAttemptId: string | null;
  runId: string | null;
  error: string | null;
  generatedAt: string | null;
  material: Material;
  facts: RunnerFacts | null;
  summary: Summary | null;
  revision: number;
}
export interface ProjectOption {
  id: string;
  name: string;
  canManage: boolean;
}
export interface AgentOption {
  id: string;
  name: string;
}
export interface ReportPageData {
  projects: ProjectOption[];
  agents: AgentOption[];
}

export function validateFacts(material: Material, facts: RunnerFacts): void {
  if (facts.attemptId !== material.attemptId)
    throw new Error('The result belongs to another attempt.');
  const expected = new Set(
    material.repositories.map((repository) => repository.resourceId),
  );
  const actual = new Set(
    facts.repositories.map((repository) => repository.resourceId),
  );
  for (const repository of facts.repositories) {
    if (
      repository.status === 'ok' &&
      repository.boundary === 'previous-snapshot'
    ) {
      const spec = material.repositories.find(
        (item) => item.resourceId === repository.resourceId,
      );
      const previous = material.previous.find(
        (item) =>
          item.resourceId === repository.resourceId &&
          item.url === spec?.url &&
          item.ref === spec?.ref &&
          item.to === material.from,
      );
      if (!previous || previous.headSha !== repository.baseSha)
        throw new Error('The result does not use the saved previous snapshot.');
    }
  }
  if (
    actual.size !== facts.repositories.length ||
    actual.size !== expected.size ||
    [...actual].some((id) => !expected.has(id))
  )
    throw new Error(
      'The result must cover each requested repository exactly once.',
    );
}

export function validateSummary(
  material: Material,
  facts: RunnerFacts,
  summary: Summary,
): void {
  const evidence = new Set([
    ...material.issues.items.map((issue) => `issue:${issue.id}`),
    ...facts.repositories.flatMap((repository) =>
      repository.commits.map(
        (commit) => `git:${repository.resourceId}:${commit.sha}`,
      ),
    ),
  ]);
  for (const item of summary.items) {
    if (item.evidence.some((id) => !evidence.has(id)))
      throw new Error('A summary item cites evidence outside this report.');
    if (
      item.stage === 'on-target-branch' &&
      !item.evidence.some((id) => id.startsWith('git:'))
    )
      throw new Error('A branch delivery needs commit evidence.');
  }
}

/** Never turn a missing repository or an unavailable test inventory into zero. */
export function totals(facts: RunnerFacts | null): {
  code: Delta | null;
  tests: Delta | null;
  estimatedTests: boolean;
} {
  const repositories = facts?.repositories ?? [];
  const sum = (values: Delta[]): Delta =>
    values.reduce(
      (total, value) => ({
        added: total.added + value.added,
        deleted: total.deleted + value.deleted,
      }),
      { added: 0, deleted: 0 },
    );
  return {
    code:
      repositories.length > 0 &&
      repositories.every((repository) => repository.code !== null)
        ? sum(
            repositories.flatMap((repository) =>
              repository.code ? [repository.code.source] : [],
            ),
          )
        : null,
    tests:
      repositories.length > 0 &&
      repositories.every((repository) => repository.tests !== null)
        ? sum(
            repositories.flatMap((repository) =>
              repository.tests ? [repository.tests] : [],
            ),
          )
        : null,
    estimatedTests: repositories.some(
      (repository) => repository.tests?.method === 'static-declarations',
    ),
  };
}
