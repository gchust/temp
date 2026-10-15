import type { PublicNetwork } from './public-network.js';
import type { MockRunContext } from '../shared/mock-types.js';

type Values = Record<string, unknown>;
export interface LegacyTransaction {
  afterCommit(callback: () => unknown): void;
}
export interface LegacyRecord extends Values {
  get(key?: string): unknown;
  set(key: string, value: unknown): void;
  toJSON(): Values;
}
export interface LegacyRepository {
  find(options?: Values): Promise<LegacyRecord[]>;
  findOne(options?: Values): Promise<LegacyRecord | null>;
  count(options?: Values): Promise<number>;
  create(options: Values): Promise<LegacyRecord>;
  update(options: Values): Promise<LegacyRecord[]>;
  destroy(options: Values): Promise<number>;
}
export interface LegacyDatabase {
  getRepository(name: string): LegacyRepository;
  readonly sequelize: {
    transaction<T>(callback: (transaction: LegacyTransaction) => Promise<T>): Promise<T>;
    query(sql: string, options?: Values): Promise<unknown>;
  };
}
export interface LegacyContext {
  action: { resourceName: string; actionName: string; params: Values & { values?: Values } };
  auth?: { user: { id: string } };
  state: Values;
  request: { query: Record<string, string | undefined>; body?: Values; headers: Record<string, string | undefined> };
  body: unknown;
  get(name: string): string;
  set(name: string, value: string): void;
  throw(status: unknown, message?: string): never;
  getCurrentLocale?(): string | undefined;
}
export interface LegacyApp {
  readonly resourceManager: {
    define(resource: { name: string; actions: Record<string, (context: LegacyContext, next: () => Promise<void>) => Promise<void>> }): void;
  };
  readonly acl: { allow(resource: string, actions: string | string[], level: 'public' | 'loggedIn'): void };
  readonly logger: { warn(message: string, details?: unknown): void };
}
export interface OutboundNetwork extends PublicNetwork {
  bind<T extends object>(target: T, methods: string[], connection?: string): void;
  mockContext(connection: string, projectId?: string): Readonly<MockRunContext>;
}
export interface LegacyMediaHost {
  readonly db: LegacyDatabase;
  readonly app: LegacyApp;
  readonly network: OutboundNetwork;
  readonly browserCollectors?: unknown;
  readonly mock?: { readonly enabled: boolean };
  project(id: string): Promise<unknown>;
  projectIds(): Promise<(string | number)[]>;
}

function method(value: unknown, key: string): boolean {
  return value !== null && typeof value === 'object' && typeof Reflect.get(value, key) === 'function';
}
function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined;
}
/** Validate the trusted application's compatibility surface at construction, not on first traffic. */
export function requireMediaHost(value: unknown): LegacyMediaHost {
  assertMediaHost(value);
  return value;
}
function assertMediaHost(value: unknown): asserts value is LegacyMediaHost {
  const db = field(value, 'db');
  const app = field(value, 'app');
  const network = field(value, 'network');
  if (!method(value, 'project') || !method(value, 'projectIds') ||
      !method(db, 'getRepository') || !method(field(db, 'sequelize'), 'transaction') ||
      !method(field(db, 'sequelize'), 'query') ||
      !method(field(app, 'resourceManager'), 'define') || !method(field(app, 'acl'), 'allow') ||
      !method(field(app, 'logger'), 'warn') ||
      !['fetch', 'selected', 'send', 'bind', 'mockContext'].every(key => method(network, key))) {
    throw new Error('Media connector requires the public legacy database, action and network ports');
  }
}
