import { describe, expect, test } from 'vitest';

import {
  resolvePlannerEnhancerEnabledFromConfig,
  resolveTaskPlannerEnhancerEnabled,
  validatePlannerEnhancerHandoff,
} from './resolve-planner-enhancer-enabled';

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'cfg-1' as never,
    _creationTime: 100,
    chatroomId: 'room-1' as never,
    userId: 'user-1' as never,
    enabled: true,
    targetId: 'handoff:planner-to-builder',
    agentHarness: 'opencode',
    model: 'gpt-4',
    machineId: 'machine-1',
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  } as never;
}

describe('resolvePlannerEnhancerEnabledFromConfig', () => {
  test('returns true when enabled and target matches', () => {
    expect(resolvePlannerEnhancerEnabledFromConfig(makeConfig())).toBe(true);
  });

  test('returns false when config is null', () => {
    expect(resolvePlannerEnhancerEnabledFromConfig(null)).toBe(false);
  });

  test('returns false when enabled is false', () => {
    expect(resolvePlannerEnhancerEnabledFromConfig(makeConfig({ enabled: false }))).toBe(false);
  });

  test('returns false when target does not match', () => {
    expect(resolvePlannerEnhancerEnabledFromConfig(makeConfig({ targetId: 'other' }))).toBe(false);
  });

  test('returns false when model or machine is whitespace', () => {
    expect(resolvePlannerEnhancerEnabledFromConfig(makeConfig({ model: ' ' }))).toBe(false);
    expect(resolvePlannerEnhancerEnabledFromConfig(makeConfig({ machineId: ' ' }))).toBe(false);
  });
});

describe('resolveTaskPlannerEnhancerEnabled', () => {
  test('uses task snapshot when set', () => {
    expect(
      resolveTaskPlannerEnhancerEnabled({
        taskPlannerEnhancerEnabled: true,
        liveConfig: null,
        role: 'planner',
      })
    ).toBe(false); // snapshot true but no config → drift bug fixed
    expect(
      resolveTaskPlannerEnhancerEnabled({
        taskPlannerEnhancerEnabled: true,
        liveConfig: makeConfig(),
        role: 'planner',
      })
    ).toBe(true);
    expect(
      resolveTaskPlannerEnhancerEnabled({
        taskPlannerEnhancerEnabled: false,
        liveConfig: makeConfig(),
        role: 'planner',
      })
    ).toBe(false);
  });

  test('snapshot true with global disabled but complete config still allows enhancer', () => {
    expect(
      resolveTaskPlannerEnhancerEnabled({
        taskPlannerEnhancerEnabled: true,
        liveConfig: makeConfig({ enabled: false }),
        role: 'planner',
      })
    ).toBe(true);
  });

  test('snapshot true with incomplete config returns false for delivery', () => {
    expect(
      resolveTaskPlannerEnhancerEnabled({
        taskPlannerEnhancerEnabled: true,
        liveConfig: makeConfig({ agentHarness: '' }),
        role: 'planner',
      })
    ).toBe(false);
  });

  test('falls back to live config when task snapshot is undefined', () => {
    expect(
      resolveTaskPlannerEnhancerEnabled({
        taskPlannerEnhancerEnabled: undefined,
        liveConfig: makeConfig(),
        role: 'planner',
      })
    ).toBe(true);
  });

  test('returns false when planner role has no config', () => {
    expect(
      resolveTaskPlannerEnhancerEnabled({
        taskPlannerEnhancerEnabled: undefined,
        liveConfig: null,
        role: 'planner',
      })
    ).toBe(false);
  });

  test('returns false for non-planner roles', () => {
    expect(
      resolveTaskPlannerEnhancerEnabled({
        taskPlannerEnhancerEnabled: undefined,
        liveConfig: makeConfig(),
        role: 'builder',
      })
    ).toBe(false);
  });
});

describe('validatePlannerEnhancerHandoff', () => {
  test('returns NOT_ENABLED when task flag is false', () => {
    const result = validatePlannerEnhancerHandoff({
      taskPlannerEnhancerEnabled: false,
      config: makeConfig(),
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('ENHANCER_NOT_ENABLED');
  });

  test('returns CONFIG_INCOMPLETE when task flag true but config missing fields', () => {
    const result = validatePlannerEnhancerHandoff({
      taskPlannerEnhancerEnabled: true,
      config: makeConfig({ agentHarness: '' }),
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('ENHANCER_CONFIG_INCOMPLETE');
  });

  test('returns allowed with config when task flag true and config complete', () => {
    const result = validatePlannerEnhancerHandoff({
      taskPlannerEnhancerEnabled: true,
      config: makeConfig(),
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.config).toBeDefined();
  });

  test('returns NOT_ENABLED when undefined flag and global config disabled', () => {
    const result = validatePlannerEnhancerHandoff({
      taskPlannerEnhancerEnabled: undefined,
      config: makeConfig({ enabled: false }),
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('ENHANCER_NOT_ENABLED');
  });

  test('returns allowed when undefined flag and global config active', () => {
    const result = validatePlannerEnhancerHandoff({
      taskPlannerEnhancerEnabled: undefined,
      config: makeConfig(),
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.config).toBeDefined();
  });

  test('returns CONFIG_INCOMPLETE when undefined flag has incomplete enabled config', () => {
    const result = validatePlannerEnhancerHandoff({
      taskPlannerEnhancerEnabled: undefined,
      config: makeConfig({ model: ' ' }),
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('ENHANCER_CONFIG_INCOMPLETE');
  });
});
