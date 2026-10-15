import { defineMigration, type MigrationDefinition } from '@nocobase/db';

const migration: MigrationDefinition = defineMigration({
  name: '202610150001_project_reports',
  async up({ builder }) {
    await builder.createCollections([
      {
        name: 'projectReportSettings',
        definition: (collection) => {
          collection.string('projectId', { length: 64 }).primary().notNull();
          collection.string('actorUserId', { length: 64 }).notNull();
          collection.json('config').notNull();
          collection.integer('revision').notNull();
        },
      },
      {
        name: 'projectDailyReports',
        definition: (collection) => {
          collection.string('id', { length: 36 }).primary().notNull();
          collection.string('projectId', { length: 64 }).notNull();
          collection.string('day', { length: 10 }).notNull();
          collection.string('timezone', { length: 100 }).notNull();
          collection.string('currentAttemptId', { length: 36 }).notNull();
          collection.string('publishedAttemptId', { length: 36 }).nullable();
          collection.integer('revision').notNull();
          collection.datetimeTz('createdAt').notNull();
          collection.datetimeTz('updatedAt').notNull();
          collection.unique(['projectId', 'day', 'timezone']);
          collection.index(['day', 'projectId']);
        },
      },
      {
        name: 'projectReportAttempts',
        definition: (collection) => {
          collection.string('id', { length: 36 }).primary().notNull();
          collection.string('reportId', { length: 36 }).notNull();
          collection.string('actorUserId', { length: 64 }).notNull();
          collection.string('agentId', { length: 64 }).notNull();
          collection.string('runId', { length: 64 }).nullable();
          collection.string('state', { length: 20 }).notNull();
          collection.json('material').notNull();
          collection.json('facts').nullable();
          collection.string('factsHash', { length: 64 }).nullable();
          collection.json('summary').nullable();
          collection.string('error', { length: 1000 }).nullable();
          collection.datetimeTz('createdAt').notNull();
          collection.datetimeTz('finishedAt').nullable();
          collection.index(['state', 'createdAt']);
          collection.index(['reportId']);
          collection.unique(['runId']);
        },
      },
      {
        name: 'projectReportLocks',
        definition: (collection) => {
          collection.string('id', { length: 32 }).primary().notNull();
          collection.string('nonce', { length: 36 }).notNull();
        },
      },
    ]);
  },
  async down({ builder }) {
    for (const name of [
      'projectReportLocks',
      'projectReportAttempts',
      'projectDailyReports',
      'projectReportSettings',
    ])
      await builder.dropCollection(name);
  },
});
export default migration;
