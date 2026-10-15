import type {
  DatabaseConnection,
  FilterBuilder,
  FilterNode,
} from '@nocobase/db';
import type { Viewer } from '../../access/viewer.js';
import { visibleIssues } from '../issues/issue.access.js';

/** Event counts, not the current status or updatedAt. Each issue counts once per event kind in [from, to). */
export interface IssueDailyFacts {
  readonly created: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly reopened: number;
  readonly items: readonly {
    readonly id: string;
    readonly identifier: string;
    readonly title: string;
    readonly created: boolean;
    readonly completed: boolean;
    readonly cancelled: boolean;
    readonly reopened: boolean;
  }[];
  readonly truncated: boolean;
}

interface IssueRow {
  id: string;
  identifier: string;
  title: string;
}
interface ActivityRow {
  issueId: string;
  details: unknown;
}

function detailsOf(value: unknown): { from?: unknown; to?: unknown } {
  try {
    const parsed: unknown =
      typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object') return {};
    return {
      from: 'from' in parsed ? parsed.from : undefined,
      to: 'to' in parsed ? parsed.to : undefined,
    };
  } catch {
    return {};
  }
}

export async function issueDailyFacts(
  conn: DatabaseConnection,
  viewer: Viewer,
  query: { readonly projectId: string; readonly from: Date; readonly to: Date },
): Promise<IssueDailyFacts> {
  const scope = (f: FilterBuilder): FilterNode =>
    f.and([
      visibleIssues(f, viewer),
      f.string('projectId').eq(query.projectId),
    ]);
  const range = (f: FilterBuilder): FilterNode =>
    f.and([
      f.date('createdAt').notBefore(query.from),
      f.date('createdAt').before(query.to),
    ]);
  const createdRows = await conn
    .repository<IssueRow>('pmIssues')
    .findMany({ filter: (f) => f.and([scope(f), range(f)]) });
  const activities = await conn
    .repository<ActivityRow>('pmActivities')
    .findMany({
      filter: (f) =>
        f.and([
          f.relation('issue').some(scope),
          f.string('action').eq('status_changed'),
          range(f),
        ]),
    });
  const created = new Set(createdRows.map((row) => row.id));
  const completed = new Set<string>();
  const cancelled = new Set<string>();
  const reopened = new Set<string>();
  for (const row of activities) {
    const { from, to } = detailsOf(row.details);
    if (to === 'done' && from !== to) completed.add(row.issueId);
    if (to === 'cancelled' && from !== to) cancelled.add(row.issueId);
    if (
      (from === 'done' || from === 'cancelled') &&
      typeof to === 'string' &&
      to !== 'done' &&
      to !== 'cancelled'
    )
      reopened.add(row.issueId);
  }
  const ids = [
    ...new Set([...created, ...completed, ...cancelled, ...reopened]),
  ].sort();
  const first = ids.slice(0, 300);
  const names = first.length
    ? await conn.repository<IssueRow>('pmIssues').findMany({
        filter: (f) =>
          f.and([scope(f), f.or(first.map((id) => f.string('id').eq(id)))]),
      })
    : [];
  const items = names
    .sort((left, right) => left.identifier.localeCompare(right.identifier))
    .map((issue) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      created: created.has(issue.id),
      completed: completed.has(issue.id),
      cancelled: cancelled.has(issue.id),
      reopened: reopened.has(issue.id),
    }));
  return {
    created: created.size,
    completed: completed.size,
    cancelled: cancelled.size,
    reopened: reopened.size,
    items,
    truncated: ids.length > items.length,
  };
}
