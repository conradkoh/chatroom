import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCommandDialogWarmState,
  getWarmedPaletteBrowseRows,
  invalidateCommandDialogWarmScope,
  resetCommandDialogWarmupForTests,
  scheduleCommandDialogWarmup,
  setWarmedPaletteBrowseRows,
} from './commandDialogWarmup';
import type { CommandPaletteRow } from '../components/CommandPalette/commandPaletteRows';

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
    scheduleCommandDialogWarmup('command-palette', 'room-1', run);

    expect(getCommandDialogWarmState('command-palette', 'room-1')).toBe('warming');
    expect(run).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
    expect(getCommandDialogWarmState('command-palette', 'room-1')).toBe('warm');
  });

  it('cancel resets warming state to cold', () => {
    const run = vi.fn();
    const cancel = scheduleCommandDialogWarmup('file-selector', 'room-1', run);

    expect(getCommandDialogWarmState('file-selector', 'room-1')).toBe('warming');
    cancel();
    expect(getCommandDialogWarmState('file-selector', 'room-1')).toBe('cold');
    vi.runAllTimers();
    expect(run).not.toHaveBeenCalled();
  });

  it('invalidateCommandDialogWarmScope clears scope entries', () => {
    scheduleCommandDialogWarmup('command-palette', 'room-1', () => {});
    scheduleCommandDialogWarmup('file-selector', 'room-1', () => {});
    scheduleCommandDialogWarmup('switcher', 'global', () => {});
    vi.runAllTimers();

    invalidateCommandDialogWarmScope('room-1');
    expect(getCommandDialogWarmState('command-palette', 'room-1')).toBe('cold');
    expect(getCommandDialogWarmState('file-selector', 'room-1')).toBe('cold');
    expect(getCommandDialogWarmState('switcher', 'global')).toBe('warm');
  });

  it('stores and retrieves warmed palette browse rows by scope', () => {
    const rows: CommandPaletteRow[] = [{ type: 'heading', id: 'h1', label: 'Test' }];
    setWarmedPaletteBrowseRows('room-1', rows);
    expect(getWarmedPaletteBrowseRows('room-1')).toEqual(rows);
    expect(getWarmedPaletteBrowseRows('room-2')).toBeNull();
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
