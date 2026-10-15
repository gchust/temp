import path from 'node:path';
import { defineServerPlugin, type AppPluginApplication } from '@nocobase/app-server/plugins';
import { ServiceProvider } from '@nocobase/service-provider';
import { connectorRegistryToken, type ConnectorDefinition, type ConnectorRuntimeContext } from '@nocoreach/connector-sdk/server';
import { GitHubSource } from './github-source.js';
import { GitHubTrends } from './github-trends.js';

export const githubConnector: ConnectorDefinition<ConnectorRuntimeContext> = {
  id: 'github',
  packageName: '@nocoreach/connector-github',
  apiVersion: 1,
  capabilities: [
    { id: 'repository.metrics', version: 1, effect: 'read' },
    { id: 'repository.traffic', version: 1, effect: 'read' },
    { id: 'repository.activity', version: 1, effect: 'read' },
    { id: 'repository.trends', version: 1, effect: 'read' },
  ],
  create(context) {
    const github = new GitHubSource(context.legacy);
    const trends = new GitHubTrends(context.legacy);
    context.expose('github', github);
    context.expose('githubTrends', trends);
    github.register();
    trends.register();
    const unschedule: (() => void)[] = [];
    return {
      start() {
        unschedule.push(context.schedule('githubCron', '0 */10 * * * *', () => github.tick()));
        unschedule.push(context.schedule('githubTrendsCron', '0 7,37 * * * *', () => trends.tick()));
      },
      close() {
        for (const remove of unschedule.splice(0).reverse()) remove();
      },
    };
  },
};

class GitHubConnectorProvider extends ServiceProvider<AppPluginApplication> {
  public readonly name = 'nocoreach/connector-github/provider';
  public override register(): void {
    this.app.container.resolve(connectorRegistryToken).register(githubConnector);
  }
}

export default defineServerPlugin({
  packageName: '@nocoreach/connector-github',
  baseDir: path.resolve(import.meta.dirname, '..'),
  serviceProviders: [GitHubConnectorProvider],
});
