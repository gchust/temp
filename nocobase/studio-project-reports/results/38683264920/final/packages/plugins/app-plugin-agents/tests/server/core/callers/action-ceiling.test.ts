import { describe, expect, it } from 'vitest';
import {
  createCallerGate,
  RUN_SELF_ACTION,
  AGENTS_VIEW_ACTION,
  type CallerIdentity,
} from '../../../../server/core/callers/index.js';
const run: CallerIdentity = {
  kind: 'run',
  userId: 'owner',
  displayName: 'Owner',
};

describe('subject action ceiling', () => {
  it('does not change existing gates without a ceiling', async () => {
    const gate = createCallerGate();
    gate.set({ allowed: async () => new Set(['pm.issues/edit']) });
    expect(await gate.allowed(run)).toEqual(
      new Set(['pm.issues/edit', RUN_SELF_ACTION, AGENTS_VIEW_ACTION]),
    );
  });
  it('removes business mutations from allowed and reach, even for a privileged owner', async () => {
    const gate = createCallerGate(() => []);
    gate.set({
      allowed: async () =>
        new Set(['pm.issues/edit', 'rel.apps/deploy', 'pm.projects/manage']),
    });
    expect(await gate.allowed(run)).toEqual(
      new Set([RUN_SELF_ACTION, AGENTS_VIEW_ACTION]),
    );
    expect(await gate.reach(run)).toEqual(
      new Set([RUN_SELF_ACTION, AGENTS_VIEW_ACTION]),
    );
  });
  it('never grants a capability only named by the ceiling', async () => {
    const gate = createCallerGate(() => ['pm.issues/view']);
    gate.set({ allowed: async () => new Set(['pm.issues/edit']) });
    expect((await gate.allowed(run)).has('pm.issues/view')).toBe(false);
  });
});
