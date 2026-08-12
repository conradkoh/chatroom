import { describe, expect, it } from 'vitest';
import { resolvePlannerRestartOnHandoffToUser } from './resolve-planner-restart-on-handoff-to-user';

describe('resolvePlannerRestartOnHandoffToUser', () => {
  it('defaults to enabled', () => expect(resolvePlannerRestartOnHandoffToUser(undefined)).toBe(true));
  it('allows opting out', () => expect(resolvePlannerRestartOnHandoffToUser({ plannerRestartOnHandoffToUser: false })).toBe(false));
  it('preserves enabled setting', () => expect(resolvePlannerRestartOnHandoffToUser({ plannerRestartOnHandoffToUser: true })).toBe(true));
});
