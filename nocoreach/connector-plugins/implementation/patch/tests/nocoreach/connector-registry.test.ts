import { describe, expect, it } from 'vitest';
import { ConnectorRegistry, type ConnectorDefinition } from '../../app-plugins/connector-sdk/server/registry.js';

function definition(id: string, overrides: Partial<ConnectorDefinition<string[]>> = {}): ConnectorDefinition<string[]> {
  return {
    id,
    packageName: `@nocoreach/connector-${id}`,
    apiVersion: 1,
    capabilities: [{ id: 'content.list', version: 1, effect: 'read' }],
    create: (events) => {
      events.push(`create:${id}`);
      return { start: () => { events.push(`start:${id}`); }, close: () => { events.push(`close:${id}`); } };
    },
    ...overrides,
  };
}

describe('ConnectorRegistry', () => {
  it('creates all dependencies before starting any connector and closes in reverse order', async () => {
    const registry = new ConnectorRegistry<string[]>();
    const events: string[] = [];
    registry.register(definition('derived', { requires: ['base'] }));
    registry.register(definition('base'));
    await registry.start(events);
    await registry.close();
    expect(events).toEqual(['create:base', 'create:derived', 'start:base', 'start:derived', 'close:derived', 'close:base']);
  });

  it('does not construct anything when a dependency is absent', async () => {
    const registry = new ConnectorRegistry<string[]>();
    const events: string[] = [];
    registry.register(definition('derived', { requires: ['absent'] }));
    await expect(Promise.resolve().then(() => registry.start(events))).rejects.toThrow('Required connector is not installed: absent');
    expect(events).toEqual([]);
  });

  it('rejects dependency cycles before construction', async () => {
    const registry = new ConnectorRegistry<string[]>();
    registry.register(definition('first', { requires: ['second'] }));
    registry.register(definition('second', { requires: ['first'] }));
    await expect(Promise.resolve().then(() => registry.start([]))).rejects.toThrow('dependency cycle');
  });

  it('rejects duplicate connector IDs', () => {
    const registry = new ConnectorRegistry<string[]>();
    registry.register(definition('github'));
    expect(() => registry.register(definition('github'))).toThrow('Duplicate connector ID');
  });

  it('rejects malformed connector IDs', () => {
    const registry = new ConnectorRegistry<string[]>();
    expect(() => registry.register(definition('../unsafe'))).toThrow('Invalid connector ID');
  });

  it('rejects duplicate capabilities inside a connector', () => {
    const registry = new ConnectorRegistry<string[]>();
    expect(() => registry.register(definition('github', { capabilities: [
      { id: 'content.list', version: 1, effect: 'read' },
      { id: 'content.list', version: 1, effect: 'read' },
    ] }))).toThrow('Duplicate capability');
  });

  it('allows explicitly bound providers to offer the same capability', () => {
    const registry = new ConnectorRegistry<string[]>();
    registry.register(definition('first'));
    registry.register(definition('second'));
    expect(registry.catalog()).toHaveLength(2);
  });

  it('allows read-only connectors without fabricated write capabilities', () => {
    const registry = new ConnectorRegistry<string[]>();
    registry.register(definition('github'));
    expect(registry.catalog()[0]?.capabilities.map(c => c.effect)).toEqual(['read']);
    expect(registry.catalog()[0]).not.toHaveProperty('create');
  });

  it('keeps independent application registries isolated', () => {
    const first = new ConnectorRegistry<string[]>();
    const second = new ConnectorRegistry<string[]>();
    first.register(definition('github'));
    expect(second.has('github')).toBe(false);
  });

  it('freezes registered metadata against later caller mutation', () => {
    const registry = new ConnectorRegistry<string[]>();
    const requires: string[] = [];
    registry.register(definition('github', { requires }));
    requires.push('missing');
    expect(registry.catalog()[0]?.requires).toEqual([]);
  });

  it('starts once despite repeated concurrent requests', async () => {
    const registry = new ConnectorRegistry<string[]>();
    const events: string[] = [];
    registry.register(definition('github'));
    await Promise.all([registry.start(events), registry.start(events)]);
    await registry.start(events);
    expect(events).toEqual(['create:github', 'start:github']);
    expect(() => registry.register(definition('later'))).toThrow('registration has already finished');
    await registry.close();
  });

  it('closes each instance once despite concurrent shutdown requests', async () => {
    const registry = new ConnectorRegistry<string[]>();
    const events: string[] = [];
    registry.register(definition('github'));
    await registry.start(events);
    await Promise.all([registry.close(), registry.close()]);
    expect(events.filter(x => x === 'close:github')).toHaveLength(1);
    await expect(registry.start(events)).rejects.toThrow('closed');
  });

  it('cleans up instances if a later factory fails', async () => {
    const registry = new ConnectorRegistry<string[]>();
    const events: string[] = [];
    registry.register(definition('first'));
    registry.register(definition('second', { create: () => { throw new Error('factory failure'); } }));
    await expect(registry.start(events)).rejects.toThrow('factory failure');
    expect(events).toEqual(['create:first', 'close:first']);
    await registry.close();
  });

  it('cleans up all instances if starting a timer fails', async () => {
    const registry = new ConnectorRegistry<string[]>();
    const events: string[] = [];
    registry.register(definition('first'));
    registry.register(definition('second', { create: () => ({
      start: () => { throw new Error('timer failure'); },
      close: () => { events.push('close:second'); },
    }) }));
    await expect(registry.start(events)).rejects.toThrow('timer failure');
    expect(events.slice(-2)).toEqual(['close:second', 'close:first']);
  });

  it('does not skip remaining cleanup when one close fails', async () => {
    const registry = new ConnectorRegistry<string[]>();
    const events: string[] = [];
    registry.register(definition('first'));
    registry.register(definition('second', { create: () => ({ close: () => { throw new Error('close failure'); } }) }));
    await registry.start(events);
    await expect(registry.close()).rejects.toThrow('Connector shutdown failed');
    expect(events).toContain('close:first');
    await registry.close();
  });

  it('waits for initialization when shutdown is requested during startup', async () => {
    const registry = new ConnectorRegistry<string[]>();
    const events: string[] = [];
    registry.register(definition('first', { create: async () => {
      await Promise.resolve();
      return { start: () => { events.push('start'); }, close: () => { events.push('close'); } };
    } }));
    await Promise.all([registry.start(events), registry.close()]);
    expect(events).toEqual(['start', 'close']);
  });
});
