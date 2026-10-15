import { authenticationToken } from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization';
import {
  RUN_SELF_ACTION,
  runIdentityOf,
} from '@nocobase/app-plugin-agents/server/tokens';
import {
  DomainError,
  projectsAccessToken,
  type Viewer,
} from '@nocobase/app-plugin-projects/server/tokens';
import type { AppPluginApplication } from '@nocobase/app-server/plugins';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponses,
  apiValidator,
  cliRoute,
  dataResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
  type AppRouteContribution,
  type ApiErrorStatus,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  SUBJECT,
  Day,
  Material,
  RunnerFacts,
  Summary,
  SettingsInput,
} from '../shared/api.js';
import { projectReportsToken } from './tokens.js';
import { reportError } from './errors.js';
import type { Attempt } from './store.js';

const ProjectId = z.object({ projectId: z.string().min(1).max(64) });
const ReportId = z.object({ reportId: z.string().uuid() });
const Request = z.strictObject({
  date: Day,
  retry: z.boolean().default(false),
  expectedRevision: z.number().int().positive().optional(),
});
const List = z.object({
  date: Day,
  days: z.coerce.number().int().min(1).max(90).default(7),
  projectId: z.string().min(1).max(64).optional(),
});
const Settings = SettingsInput.omit({ expectedRevision: true }).extend({
  projectId: z.string(),
  actorUserId: z.string(),
  revision: z.number().int(),
});
const Report = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  date: Day,
  timezone: z.string(),
  status: z.enum(['generating', 'ready', 'partial', 'failed']),
  currentAttemptId: z.string(),
  publishedAttemptId: z.string().nullable(),
  runId: z.string().nullable(),
  error: z.string().nullable(),
  generatedAt: z.string().nullable(),
  material: Material,
  facts: RunnerFacts.nullable(),
  summary: Summary.nullable(),
  revision: z.number().int(),
});
const accepted = z.object({ accepted: z.literal(true) });
const tags = ['Project reports'];
type UserEnv = AuthorizationEnv & {
  Variables: { auth: { user: { id: string } }; reportViewer: Viewer };
};
type RunEnv = {
  Variables: {
    auth: Parameters<typeof runIdentityOf>[0];
    reportAttempt: Attempt;
    reportRunId: string;
  };
};
const statuses: Record<DomainError['kind'], ApiErrorStatus> = {
  invalid: 'INVALID_ARGUMENT',
  unauthorized: 'UNAUTHENTICATED',
  forbidden: 'PERMISSION_DENIED',
  notFound: 'NOT_FOUND',
  conflict: 'ABORTED',
};

export const apiRoutes: AppApiRouteContribution<AppPluginApplication> =
  defineApiRoutes(({ container }) => {
    const reports = container.resolve(projectReportsToken);
    const authentication = container.resolve(authenticationToken);
    const authorization = container.resolve(authorizationToken);
    const access = container.resolve(projectsAccessToken);
    const root = new Hono();
    root.onError((error, context) =>
      apiErrorHandler(
        error instanceof DomainError
          ? new ApiError({
              domain: 'projects',
              status: statuses[error.kind],
              reason: error.code,
              message: error.message,
            })
          : error instanceof z.ZodError
            ? reportError(
                'INVALID_ARGUMENT',
                'REPORT_INPUT_INVALID',
                'The report input is invalid.',
              )
            : error,
        context,
      ),
    );

    // A live run credential and exact subject/run/attempt binding are the complete authorization for these self routes.
    // No user session or unrelated run can publish; a human's project-manage permission is rechecked by current().
    const current = new Hono<RunEnv>();
    current.use('*', authentication.required({ scopedKeys: true }));
    current.use('*', bodyLimit({ maxSize: 4 * 1024 * 1024 }));
    current.use('*', async (context, next) => {
      const identity = runIdentityOf(context.get('auth'));
      const run = identity?.run?.run;
      if (!run || run.subjectKind !== SUBJECT)
        throw reportError(
          'PERMISSION_DENIED',
          'REPORT_RUN_REQUIRED',
          'A live project report run is required.',
        );
      const attempt = await reports.current(
        run.id,
        run.subjectId,
        identity.userId,
      );
      context.set('reportRunId', run.id);
      context.set('reportAttempt', attempt);
      await next();
    });
    current.get(
      '/',
      describeRoute({
        tags,
        summary: 'Read the current report material',
        operationId: 'projectReportsCurrent',
        ...cliRoute({ command: 'report current', action: RUN_SELF_ACTION }),
        security: [{ runToken: [] }],
        responses: {
          200: dataResponse(
            z.object({ material: Material, facts: RunnerFacts.nullable() }),
          ),
          ...apiErrorResponses,
        },
      }),
      (context) => {
        const attempt = context.get('reportAttempt');
        return context.json({
          data: { material: attempt.material, facts: attempt.facts },
        });
      },
    );
    current.post(
      '/facts',
      describeRoute({
        tags,
        summary: 'Submit immutable runner collection facts',
        operationId: 'projectReportsSubmitFacts',
        ...cliRoute({ command: 'report facts', action: RUN_SELF_ACTION }),
        security: [{ runToken: [] }],
        responses: { 200: dataResponse(accepted), ...apiErrorResponses },
      }),
      apiValidator('json', RunnerFacts),
      async (context) => {
        const attempt = context.get('reportAttempt');
        await reports.acceptFacts(
          context.get('reportRunId'),
          attempt.id,
          attempt.actorUserId,
          context.req.valid('json'),
        );
        return context.json({ data: { accepted: true as const } });
      },
    );
    current.post(
      '/publish',
      describeRoute({
        tags,
        summary: 'Publish an evidence-backed report summary',
        operationId: 'projectReportsPublish',
        ...cliRoute({ command: 'report publish', action: RUN_SELF_ACTION }),
        security: [{ runToken: [] }],
        responses: { 200: dataResponse(accepted), ...apiErrorResponses },
      }),
      apiValidator('json', Summary),
      async (context) => {
        const attempt = context.get('reportAttempt');
        await reports.publish(
          context.get('reportRunId'),
          attempt.id,
          attempt.actorUserId,
          context.req.valid('json'),
        );
        return context.json({ data: { accepted: true as const } });
      },
    );
    root.route('/project-reports/current', current);

    const users = new Hono<UserEnv>();
    users.use('*', authentication.required());
    users.use('*', authorization.middleware());
    users.use('*', bodyLimit({ maxSize: 32 * 1024 }));
    users.use('*', async (context, next) => {
      const authz = context.get('authz');
      if (
        !(await authz.can({
          resource: { type: 'page', id: 'reports' },
          action: 'access',
        }))
      )
        throw reportError(
          'PERMISSION_DENIED',
          'REPORTS_FORBIDDEN',
          'The reports page grant is required.',
        );
      const userId = context.get('auth').user.id;
      context.set('reportViewer', {
        userId,
        actor: { type: 'user', id: userId },
        permissions: await access.permissionsOf(authz.identity),
      });
      await next();
    });
    users.get(
      '/options',
      describeRoute({
        tags,
        summary: 'List readable projects and report agents',
        operationId: 'projectReportsOptions',
        responses: {
          200: dataResponse(
            z.object({
              projects: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  canManage: z.boolean(),
                }),
              ),
              agents: z.array(z.object({ id: z.string(), name: z.string() })),
            }),
          ),
          ...apiErrorResponses,
        },
      }),
      async (context) =>
        context.json({
          data: await reports.options(context.get('reportViewer')),
        }),
    );
    users.get(
      '/',
      describeRoute({
        tags,
        summary: 'List daily reports and their historical metrics',
        operationId: 'projectReportsList',
        responses: {
          200: dataResponse(
            z.object({ reports: z.array(Report), truncated: z.boolean() }),
          ),
          ...apiErrorResponses,
        },
      }),
      apiValidator('query', List),
      async (context) =>
        context.json({
          data: await reports.list(
            context.get('reportViewer'),
            context.req.valid('query'),
          ),
        }),
    );
    users.get(
      '/projects/:projectId/settings',
      describeRoute({
        tags,
        summary: 'Read project report settings',
        operationId: 'projectReportsSettings',
        responses: { 200: dataResponse(Settings), ...apiErrorResponses },
      }),
      apiValidator('param', ProjectId),
      async (context) =>
        context.json({
          data: await reports.settings(
            context.get('reportViewer'),
            context.req.valid('param').projectId,
          ),
        }),
    );
    users.put(
      '/projects/:projectId/settings',
      describeRoute({
        tags,
        summary: 'Configure project report scheduling',
        operationId: 'projectReportsSaveSettings',
        responses: { 200: dataResponse(Settings), ...apiErrorResponses },
      }),
      apiValidator('param', ProjectId),
      apiValidator('json', SettingsInput),
      async (context) =>
        context.json({
          data: await reports.saveSettings(
            context.get('reportViewer'),
            context.req.valid('param').projectId,
            context.req.valid('json'),
          ),
        }),
    );
    users.post(
      '/projects/:projectId/generate',
      describeRoute({
        tags,
        summary: 'Generate or regenerate a completed project day',
        operationId: 'projectReportsGenerate',
        responses: { 200: dataResponse(Report), ...apiErrorResponses },
      }),
      apiValidator('param', ProjectId),
      apiValidator('json', Request),
      async (context) => {
        const body = context.req.valid('json');
        const report = await reports.request(
          context.get('reportViewer'),
          context.req.valid('param').projectId,
          body.date,
          body.retry,
          body.expectedRevision,
        );
        return context.json({ data: report });
      },
    );
    users.post(
      '/:reportId/cancel',
      describeRoute({
        tags,
        summary: 'Cancel report generation',
        operationId: 'projectReportsCancel',
        responses: { 200: dataResponse(accepted), ...apiErrorResponses },
      }),
      apiValidator('param', ReportId),
      async (context) => {
        await reports.cancel(
          context.get('reportViewer'),
          context.req.valid('param').reportId,
        );
        return context.json({ data: { accepted: true as const } });
      },
    );
    users.get(
      '/:reportId',
      describeRoute({
        tags,
        summary: 'Read a project daily report',
        operationId: 'projectReportsGet',
        responses: { 200: dataResponse(Report), ...apiErrorResponses },
      }),
      apiValidator('param', ReportId),
      async (context) =>
        context.json({
          data: await reports.get(
            context.get('reportViewer'),
            context.req.valid('param').reportId,
          ),
        }),
    );
    root.route('/project-reports', users);
    return root;
  });
const routes: readonly AppRouteContribution<AppPluginApplication>[] = [
  apiRoutes,
];
export default routes;
