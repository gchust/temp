/** Persisted and runner-facing contracts. Runtime validation lives in api.ts. */
export interface RepositorySpec {
  resourceId: string;
  url: string;
  ref: string | null;
}
export interface IssueFact {
  id: string;
  identifier: string;
  title: string;
  created: boolean;
  completed: boolean;
  cancelled: boolean;
  reopened: boolean;
}
export interface IssueFacts {
  created: number;
  completed: number;
  cancelled: number;
  reopened: number;
  items: IssueFact[];
  truncated: boolean;
}
export interface Material {
  version: 1;
  reportId: string;
  attemptId: string;
  projectId: string;
  projectName: string;
  date: string;
  timezone: string;
  from: string;
  to: string;
  locale: 'en' | 'zh-CN';
  repositories: RepositorySpec[];
  issues: IssueFacts;
  previous: (RepositorySpec & { to: string; headSha: string | null })[];
}
export interface Delta {
  added: number;
  deleted: number;
}
export interface CodeFigures {
  source: Delta;
  tests: Delta;
  documentation: Delta;
  configuration: Delta;
  generated: Delta;
  files: number;
  binaryFiles: number;
}
export interface TestFigures extends Delta {
  method: 'inventory' | 'static-declarations';
  before: number;
  after: number;
}
export interface CommitFact {
  sha: string;
  title: string;
}
export interface RepositoryFacts {
  resourceId: string;
  status: 'ok' | 'failed';
  baseSha: string | null;
  headSha: string | null;
  boundary: 'previous-snapshot' | 'commit-time-estimate';
  code: CodeFigures | null;
  tests: TestFigures | null;
  commits: CommitFact[];
  commitCount: number;
  warnings: string[];
  truncated: boolean;
}
export interface RunnerFacts {
  version: 1;
  attemptId: string;
  repositories: RepositoryFacts[];
}
export interface SummaryItem {
  category:
    | 'feature'
    | 'architecture'
    | 'critical-fix'
    | 'fix'
    | 'maintenance'
    | 'risk';
  title: string;
  description: string;
  stage:
    'on-target-branch' | 'in-progress' | 'resolved' | 'unresolved' | 'unknown';
  evidence: string[];
}
export interface Summary {
  overview: string;
  items: SummaryItem[];
  minorFixes: string;
}
