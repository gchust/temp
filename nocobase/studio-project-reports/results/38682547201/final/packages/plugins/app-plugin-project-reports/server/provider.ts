import { readFile } from 'node:fs/promises';
import { ServiceProvider } from '@nocobase/service-provider';
import type { AppPluginApplication } from '@nocobase/app-server/plugins';
import { agentsToken } from '@nocobase/app-plugin-agents/server/tokens';
import {
  projectsToken,
  projectsAccessToken,
} from '@nocobase/app-plugin-projects/server/tokens';
import { schedulerServiceToken } from '@nocobase/app-plugin-scheduler/server/tokens';
import { ProjectReports } from './service.js';
import { projectReportsToken } from './tokens.js';
import { reportBinding, reportMount } from './runtime.js';

export class ProjectReportsProvider extends ServiceProvider<AppPluginApplication> {
  readonly name = '@nocobase/app-plugin-project-reports';
  private readonly dispose: (() => void)[] = [];
  override register(): void {
    this.app.container.singleton(
      projectReportsToken,
      (container) =>
        new ProjectReports({
          agents: container.resolve(agentsToken),
          projects: container.resolve(projectsToken),
          access: container.resolve(projectsAccessToken),
          onError: (message, error) => console.error(message, error),
        }),
    );
  }
  override async boot(): Promise<void> {
    const service = this.app.container.resolve(projectReportsToken);
    const agents = this.app.container.resolve(agentsToken);
    const collector = await readFile(
      new URL('../runner/collector.mjs', import.meta.url),
      'utf8',
    );
    this.dispose.push(
      agents.subjects.register(reportBinding(service)),
      agents.mounts.register(reportMount(collector)),
    );
    const scheduler = this.app.container.resolve(schedulerServiceToken);
    scheduler.registerTarget({
      type: 'project-reports.dispatch',
      title: 'Dispatch project daily reports',
      validate: (config) => ({
        valid:
          !!config &&
          typeof config === 'object' &&
          !Array.isArray(config) &&
          Object.keys(config).length === 0,
      }),
      async start() {
        const result = await service.tick();
        return {
          state: 'completed' as const,
          outcome: 'succeeded' as const,
          result,
        };
      },
    });
    scheduler.defineSchedule({
      key: 'project-reports.dispatch',
      title: 'Project reports dispatcher',
      schedule: { cron: '0 * * * * *', timezone: 'UTC' },
      target: { type: 'project-reports.dispatch', config: {} },
    });
  }
  override async shutdown(): Promise<void> {
    for (const dispose of this.dispose.splice(0)) dispose();
  }
}
