export type ConnectorEffect = 'read' | 'draft' | 'publish' | 'update' | 'delete';

export interface ConnectorCapability {
  readonly id: string;
  readonly version: number;
  readonly effect: ConnectorEffect;
}

export interface ConnectorMetadata {
  readonly id: string;
  readonly packageName: string;
  readonly apiVersion: 1;
  readonly requires?: readonly string[];
  readonly capabilities: readonly ConnectorCapability[];
}

export interface ConnectorInstance {
  /** Called only after every installed connector has been created. */
  start?(): void | Promise<void>;
  /** Must also release partially initialized resources. */
  close(): void | Promise<void>;
}

export interface ConnectorDefinition<Context> extends ConnectorMetadata {
  create(context: Context): ConnectorInstance | Promise<ConnectorInstance>;
}

export class ConnectorRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectorRegistrationError';
  }
}

/** Instance-scoped registry. Installing code never grants permission to execute it. */
export class ConnectorRegistry<Context> {
  private readonly definitions = new Map<string, ConnectorDefinition<Context>>();
  private readonly instances: ConnectorInstance[] = [];
  private state: 'registering' | 'starting' | 'ready' | 'closing' | 'closed' = 'registering';
  private transition: Promise<void> | undefined;

  register(definition: ConnectorDefinition<Context>): void {
    if (this.state !== 'registering') {
      throw new ConnectorRegistrationError('Connector registration has already finished');
    }
    if (!/^[a-z][a-z0-9-]*$/.test(definition.id)) {
      throw new ConnectorRegistrationError(`Invalid connector ID: ${definition.id}`);
    }
    if (definition.apiVersion !== 1) {
      throw new ConnectorRegistrationError(`Unsupported API version for ${definition.id}`);
    }
    if (!definition.packageName.trim()) {
      throw new ConnectorRegistrationError(`Missing package name for ${definition.id}`);
    }
    if (this.definitions.has(definition.id)) {
      throw new ConnectorRegistrationError(`Duplicate connector ID: ${definition.id}`);
    }
    const capabilities = new Set<string>();
    for (const capability of definition.capabilities) {
      if (!capability.id || !Number.isInteger(capability.version) || capability.version < 1) {
        throw new ConnectorRegistrationError(`Invalid capability in ${definition.id}`);
      }
      const key = `${capability.id}@${capability.version}`;
      if (capabilities.has(key)) {
        throw new ConnectorRegistrationError(`Duplicate capability ${key} in ${definition.id}`);
      }
      capabilities.add(key);
    }
    const stored = Object.freeze({
      ...definition,
      requires: Object.freeze([...(definition.requires ?? [])]),
      capabilities: Object.freeze(definition.capabilities.map((entry) => Object.freeze({ ...entry }))),
    });
    this.definitions.set(stored.id, stored);
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  /** No factories, credentials, or executable module paths are exposed. */
  catalog(): readonly ConnectorMetadata[] {
    return [...this.definitions.values()].map(({ id, packageName, apiVersion, requires, capabilities }) => ({
      id,
      packageName,
      apiVersion,
      requires,
      capabilities,
    }));
  }

  private ordered(): readonly ConnectorDefinition<Context>[] {
    const ordered: ConnectorDefinition<Context>[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new ConnectorRegistrationError(`Connector dependency cycle at ${id}`);
      const definition = this.definitions.get(id);
      if (!definition) throw new ConnectorRegistrationError(`Required connector is not installed: ${id}`);
      visiting.add(id);
      for (const dependency of definition.requires ?? []) visit(dependency);
      visiting.delete(id);
      visited.add(id);
      ordered.push(definition);
    };
    for (const id of this.definitions.keys()) visit(id);
    return ordered;
  }

  start(context: Context): Promise<void> {
    if (this.state === 'ready') return Promise.resolve();
    if (this.state === 'starting' && this.transition) return this.transition;
    if (this.state !== 'registering') return Promise.reject(new Error('Connector registry is closed'));
    // Validate the complete dependency graph before any factory can have side effects.
    const ordered = this.ordered();
    this.state = 'starting';
    this.transition = this.initialize(ordered, context);
    return this.transition;
  }

  private async initialize(ordered: readonly ConnectorDefinition<Context>[], context: Context): Promise<void> {
    try {
      for (const definition of ordered) this.instances.push(await definition.create(context));
      for (const instance of this.instances) await instance.start?.();
      this.state = 'ready';
    } catch (error: unknown) {
      const cleanupErrors = await this.dispose();
      this.state = 'closed';
      if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], 'Connector startup failed');
      throw error;
    }
  }

  close(): Promise<void> {
    if (this.state === 'closed') return Promise.resolve();
    if (this.state === 'closing' && this.transition) return this.transition;
    if (this.state === 'starting' && this.transition) {
      return this.transition.then(() => this.close(), () => undefined);
    }
    this.state = 'closing';
    this.transition = this.shutdown();
    return this.transition;
  }

  private async dispose(): Promise<unknown[]> {
    const errors: unknown[] = [];
    for (const instance of this.instances.splice(0).reverse()) {
      try { await instance.close(); } catch (error: unknown) { errors.push(error); }
    }
    return errors;
  }

  private async shutdown(): Promise<void> {
    const errors = await this.dispose();
    this.state = 'closed';
    if (errors.length) throw new AggregateError(errors, 'Connector shutdown failed');
  }
}
