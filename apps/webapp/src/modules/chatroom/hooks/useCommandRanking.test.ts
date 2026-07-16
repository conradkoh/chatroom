import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';

import { useCommandRanking } from './useCommandRanking';
import type { CommandItem } from '../components/CommandPalette/types';
import { getCommandUsageStore } from '../lib/commandUsageStore';

function makeCmd(id: string, label: string, category = 'Test'): CommandItem {
  return { id, label, category, action: () => undefined };
}

describe('useCommandRanking', () => {
  beforeEach(() => {
    getCommandUsageStore().clear();
  });

  test('getScore returns 0 for unused commands', () => {
    const commands = [makeCmd('nav-a', 'A')];
    const { result } = renderHook(() => useCommandRanking(commands));
    expect(result.current.getScore(commands[0])).toBe(0);
  });

  test('trackUsage bumps version and score becomes positive', () => {
    const cmd = makeCmd('nav-a', 'A');
    const { result } = renderHook(() => useCommandRanking([cmd]));

    act(() => {
      result.current.trackUsage(cmd);
    });

    expect(result.current.getScore(cmd)).toBeGreaterThan(0);
  });

  test('trackUsage stores stable frecency key not label', () => {
    const cmd = makeCmd('saved-cmd-abc', 'Command: My Cmd (Chatroom)');
    const { result } = renderHook(() => useCommandRanking([cmd]));

    act(() => {
      result.current.trackUsage(cmd);
    });

    // Score should be keyed by id not label
    const store = getCommandUsageStore();
    const timestampsSavedCmd = store.getTimestamps('saved-cmd-abc');
    expect(timestampsSavedCmd).toHaveLength(1);
    const timestampsLabel = store.getTimestamps('Command: My Cmd (Chatroom)');
    expect(timestampsLabel).toHaveLength(0);
  });

  test('combined sources rank correctly via getScore', () => {
    const savedCmd = makeCmd('saved-cmd-low', 'Low Score Saved');
    const builtinCmd = makeCmd('nav-high', 'High Score Builtin');
    const commands = [savedCmd, builtinCmd];

    const { result } = renderHook(() => useCommandRanking(commands));

    // Use builtin 3 times, saved once
    act(() => {
      result.current.trackUsage(builtinCmd);
      result.current.trackUsage(builtinCmd);
      result.current.trackUsage(builtinCmd);
      result.current.trackUsage(savedCmd);
    });

    expect(result.current.getScore(builtinCmd)).toBeGreaterThan(result.current.getScore(savedCmd));
  });
});
