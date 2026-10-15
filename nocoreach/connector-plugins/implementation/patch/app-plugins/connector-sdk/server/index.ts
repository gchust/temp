import path from 'node:path';
import { defineServerPlugin, type AppPluginApplication } from '@nocobase/app-server/plugins';
import { createServiceToken, ServiceProvider, type ServiceToken } from '@nocobase/service-provider';
import { ConnectorRegistry } from './registry.js';

export * from './registry.js';

/** The temporary compatibility host is opaque outside a migrated legacy adapter. */
export interface ConnectorRuntimeContext {
  readonly legacy: unknown;
  expose(name: string, service: object): void;
  schedule(name: string, cronTime: string, onTick: () => Promise<unknown>): () => void;
}

export const connectorRegistryToken: ServiceToken<ConnectorRegistry<ConnectorRuntimeContext>> =
  createServiceToken<ConnectorRegistry<ConnectorRuntimeContext>>('nocoreach/connectors/registry');

class ConnectorRegistryProvider extends ServiceProvider<AppPluginApplication> {
  public readonly name = 'nocoreach/connectors/provider';
  public override register(): void {
    this.app.container.singleton(connectorRegistryToken, () => new ConnectorRegistry<ConnectorRuntimeContext>());
  }
}

export default defineServerPlugin({
  packageName: '@nocoreach/connector-sdk',
  baseDir: path.resolve(import.meta.dirname, '..'),
  serviceProviders: [ConnectorRegistryProvider],
});
