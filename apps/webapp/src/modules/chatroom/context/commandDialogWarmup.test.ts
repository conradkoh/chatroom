import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCommandDialogWarmState,
  invalidateCommandDialogWarmScope,
  resetCommandDialogWarmupForTests,
  scheduleCommandDialogWarmup,
} from './commandDialogWarmup';

describe('commandDialogWarmup', () => {
  beforeEach(() => {
    resetCommandDialogWarmupForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedule sets warming then warm on idle execute', () => {
    const run = vi.fn();
    scheduleCommandDialogWarmup('switcher', 'global', run);

    expect(getCommandDialogWarmState('switcher', 'global')).toBe('warming');
    expect(run).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
    expect(getCommandDialogWarmState('switcher', 'global')).toBe('warm');
  });

  it('cancel resets warming state to cold', () => {
    const run = vi.fn();
    const cancel = scheduleCommandDialogWarmup('switcher', 'global', run);

    expect(getCommandDialogWarmState('switcher', 'global')).toBe('warming');
    cancel();
    expect(getCommandDialogWarmState('switcher', 'global')).toBe('cold');
    vi.runAllTimers();
    expect(run).not.toHaveBeenCalled();
  });

  it('invalidateCommandDialogWarmScope clears scope entries', () => {
    scheduleCommandDialogWarmup('switcher', 'global', () => {});
    vi.runAllTimers();
    expect(getCommandDialogWarmState('switcher', 'global')).toBe('warm');

    invalidateCommandDialogWarmScope('global');
    expect(getCommandDialogWarmState('switcher', 'global')).toBe('cold');
  });

  it('skips scheduling when already warm', () => {
    const run = vi.fn();
    scheduleCommandDialogWarmup('switcher', 'global', () => {});
    vi.runAllTimers();
    run.mockClear();

    scheduleCommandDialogWarmup('switcher', 'global', run);
    vi.runAllTimers();
    expect(run).not.toHaveBeenCalled();
  });
});
