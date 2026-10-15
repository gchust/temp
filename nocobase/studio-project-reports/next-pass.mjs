import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] ?? 'source');
const path = resolve(root, 'packages/plugins/app-plugin-project-reports/tests/service.test.ts');
let text = await readFile(path, 'utf8');
const index = text.lastIndexOf('\n});');
text = text.slice(0, index) + `
  it('serializes concurrent publication and preserves the first accepted summary', async () => {
    const report = await active();
    await reports.acceptFacts(report.runId!, report.currentAttemptId, 'owner', facts(report));
    const first = summary();
    const second = { ...first, overview: 'Another summary of the same day.' };
    const results = await Promise.allSettled([
      reports.publish(report.runId!, report.currentAttemptId, 'owner', first),
      reports.publish(report.runId!, report.currentAttemptId, 'owner', second),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await reports.get(viewer, report.id)).summary).not.toBeNull();
  });
` + text.slice(index);
await writeFile(path, text);
