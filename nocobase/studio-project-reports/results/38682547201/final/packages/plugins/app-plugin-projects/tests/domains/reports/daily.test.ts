import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../../harness.js';
let h: Harness;
beforeEach(async () => {
  h = await createHarness();
  await h.addUser('owner');
  await h.addUser('outsider');
});
afterEach(async () => {
  await h?.close();
});

describe('daily issue facts', () => {
  it('counts each event kind once, uses a half-open window and respects project visibility', async () => {
    const owner = h.viewer('owner', 'admin');
    const project = await h.services.projects.create(owner, {
      name: 'Daily facts',
      visibility: 'members',
      leadUserId: 'owner',
    });
    let issue = await h.services.issues.create(owner, {
      title: 'Daily work',
      projectId: project.id,
      statusKey: 'in_progress',
    });
    for (const statusKey of ['done', 'in_progress', 'done', 'cancelled'])
      issue = await h.services.issues.update(owner, issue.id, {
        statusKey,
        revision: issue.revision,
      });
    const from = new Date('2026-10-14T00:00:00.000Z');
    const to = new Date('2026-10-15T00:00:00.000Z');
    const conn = h.database.connection();
    await conn.query
      .updateTable('pmIssues')
      .set({ createdAt: from })
      .where('id', '=', issue.id)
      .execute();
    await conn.query
      .updateTable('pmActivities')
      .set({ createdAt: from })
      .where('issueId', '=', issue.id)
      .execute();
    const report = await h.services.reports.daily(owner, {
      projectId: project.id,
      from,
      to,
    });
    expect(report).toMatchObject({
      created: 1,
      completed: 1,
      cancelled: 1,
      reopened: 1,
      truncated: false,
    });
    expect(report.items).toHaveLength(1);
    const other = await h.services.reports.daily(h.viewer('outsider'), {
      projectId: project.id,
      from,
      to,
    });
    expect(other).toMatchObject({
      created: 0,
      completed: 0,
      cancelled: 0,
      reopened: 0,
      items: [],
    });
    await conn.query
      .updateTable('pmActivities')
      .set({ createdAt: to })
      .where('issueId', '=', issue.id)
      .execute();
    const boundary = await h.services.reports.daily(owner, {
      projectId: project.id,
      from,
      to,
    });
    expect(boundary).toMatchObject({
      created: 1,
      completed: 0,
      cancelled: 0,
      reopened: 0,
    });
  });
});
