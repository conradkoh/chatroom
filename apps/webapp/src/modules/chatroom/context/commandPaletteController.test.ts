import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCommandPaletteOpen,
  getCommandPaletteRunsActive,
  resetCommandPalette,
  setCommandPaletteOpen,
  subscribeCommandPaletteOpen,
  subscribeCommandPaletteRunsActive,
  toggleCommandPaletteOpen,
} from './commandPaletteController';

describe('commandPaletteController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCommandPalette();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('setCommandPaletteOpen(true) notifies open subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommandPaletteOpen(listener);

    setCommandPaletteOpen(true);
    expect(getCommandPaletteOpen()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('defers runsActive until after RUNS_ACTIVE_DELAY_MS', () => {
    const runsListener = vi.fn();
    subscribeCommandPaletteRunsActive(runsListener);

    setCommandPaletteOpen(true);
    expect(getCommandPaletteRunsActive()).toBe(false);
    expect(runsListener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(getCommandPaletteRunsActive()).toBe(true);
    expect(runsListener).toHaveBeenCalledTimes(1);
  });

  it('resetCommandPalette clears open and runsActive', () => {
    setCommandPaletteOpen(true);
    vi.advanceTimersByTime(100);
    expect(getCommandPaletteOpen()).toBe(true);
    expect(getCommandPaletteRunsActive()).toBe(true);

    resetCommandPalette();
    expect(getCommandPaletteOpen()).toBe(false);
    expect(getCommandPaletteRunsActive()).toBe(false);
  });

  it('toggleCommandPaletteOpen toggles open state', () => {
    expect(getCommandPaletteOpen()).toBe(false);
    toggleCommandPaletteOpen();
    expect(getCommandPaletteOpen()).toBe(true);
    toggleCommandPaletteOpen();
    expect(getCommandPaletteOpen()).toBe(false);
  });
});
