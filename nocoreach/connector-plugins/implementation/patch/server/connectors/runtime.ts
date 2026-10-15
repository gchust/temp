import type { ConnectorRuntimeContext } from '@nocoreach/connector-sdk/server';
import type { LegacyApp } from '../nocoreach/legacy/app.js';

interface LegacyRuntimeHost {
  readonly app: LegacyApp;
}

/** Compatibility stays in the application; independently installed packages do not import it. */
export function createConnectorContext(host: LegacyRuntimeHost): ConnectorRuntimeContext {
  return {
    legacy: host,
    expose(name, service) {
      if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) throw new Error(`Invalid connector service name: ${name}`);
      if (Reflect.get(host, name) !== undefined) throw new Error(`Connector service is already registered: ${name}`);
      Object.defineProperty(host, name, { configurable: true, enumerable: true, writable: false, value: service });
    },
    schedule(name, cronTime, onTick) {
      const job = host.app.cronJobManager.addJob({
        name,
        cronTime,
        onTick: async () => {
          try { await onTick(); }
          catch (error: unknown) {
            host.app.logger.warn('NocoReach connector tick failed', {
              job: name,
              message: error instanceof Error ? error.message.slice(0, 300) : 'Unknown connector error',
            });
          }
        },
      });
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        host.app.cronJobManager.removeJob(job);
      };
    },
  };
}
