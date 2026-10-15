/** Structural compatibility contracts, not a database implementation or an application import. */
export interface LegacyRecord {
  readonly id: string;
  get(key: string): unknown;
  toJSON(): Record<string, unknown>;
}

export interface LegacyTransaction {
  afterCommit(callback: () => void | Promise<void>): void;
}

export interface LegacyRepository {
  findOne(options: unknown): Promise<LegacyRecord | null>;
  find(options: unknown): Promise<LegacyRecord[]>;
  create(options: unknown): Promise<LegacyRecord>;
  update(options: unknown): Promise<unknown>;
  destroy(options: unknown): Promise<unknown>;
}

export interface LegacyDatabase {
  getRepository(name: string): LegacyRepository;
}

/** Only what the existing OAuth adapter consumes; cookie/cache semantics remain host-owned. */
export interface LegacyContext {
  auth?: { user: { id: string } };
  request: { query: Record<string, string | undefined> };
  cache: { take(key: string): Promise<unknown> };
  cookies: {
    get(name: string): string | undefined;
    set(name: string, value: string | null, options: Record<string, unknown>): void;
  };
  set(name: string, value: string): void;
  redirect(url: string): void;
  logger: { warn(message: string, details?: Record<string, unknown>): void };
}
