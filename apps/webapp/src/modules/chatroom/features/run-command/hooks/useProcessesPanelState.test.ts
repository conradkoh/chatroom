import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunnableCommand, CommandRun } from '../types/run';

// Stub useCommandFavorites so we don't need localStorage
vi.mock('./useCommandFavorites', () => ({
  useCommandFavorites: () => ({
    favorites: new Set<string>(),
    toggle: vi.fn(),
    isFavorite: vi.fn(() => false),
    version: 0,
  }),
}));

import { useProcessesPanelState } from './useProcessesPanelState';

const makeCommand = (name: string, subPath = '.'): RunnableCommand => ({
  _id: `cmd-${name}` as RunnableCommand['_id'],
  _creationTime: 0,
  machineId: 'machine-1',
  workingDir: '/workspace',
  syncedAt: 0,
  name,
  script: `pnpm ${name}`,
  source: 'package.json',
  subWorkspace: { type: 'npm', path: subPath, name },
});

const makeRun = (
  id: string,
  commandName: string,
  status: CommandRun['status'] = 'running'
): CommandRun => ({
  _id: id as CommandRun['_id'],
  commandName,
  status,
  script: `pnpm ${commandName}`,
  pid: 1234,
  startedAt: Date.now(),
  exitCode: undefined,
  terminationReason: undefined,
});

const defaultOpts = {
  commands: [makeCommand('dev'), makeCommand('build'), makeCommand('test', 'apps/api')],
  runs: [] as CommandRun[],
  onClearRun: vi.fn(),
};

describe('useProcessesPanelState', () => {
  it('initialises with empty search and no selections', () => {
    const { result } = renderHook(() => useProcessesPanelState(defaultOpts));
    expect(result.current.searchQuery).toBe('');
    expect(result.current.selectedCommand).toBeNull();
    expect(result.current.selectedWorkspace).toBeNull();
    expect(result.current.focusedIndex).toBe(0);
  });

  it('filters commands by search query', () => {
    const { result } = renderHook(() => useProcessesPanelState(defaultOpts));

    act(() => result.current.setSearchQuery('dev'));

    const matches = result.current.workspaceGroups.flatMap((g) => g.allCommands);
    expect(matches.every((c) => c.name.includes('dev'))).toBe(true);
  });

  it('resets focusedIndex when search changes', () => {
    const { result } = renderHook(() => useProcessesPanelState(defaultOpts));

    act(() => result.current.setFocusedIndex(2));
    expect(result.current.focusedIndex).toBe(2);

    act(() => result.current.setSearchQuery('b'));
    expect(result.current.focusedIndex).toBe(0);
  });

  it('returns runningProcesses and recentRuns correctly', () => {
    const runs = [
      makeRun('r1', 'dev', 'running'),
      makeRun('r2', 'build', 'completed'),
      makeRun('r3', 'test', 'failed'),
    ];
    const { result } = renderHook(() =>
      useProcessesPanelState({ ...defaultOpts, runs })
    );
    expect(result.current.runningProcesses).toHaveLength(1);
    expect(result.current.recentRuns).toHaveLength(2);
  });

  it('pre-selects command from initialSelectedCommand', async () => {
    const onConsumedInitialCommand = vi.fn();
    const { result } = renderHook(() =>
      useProcessesPanelState({
        ...defaultOpts,
        initialSelectedCommand: 'dev',
        onConsumedInitialCommand,
      })
    );

    // useEffect runs after render
    await act(async () => {});

    expect(result.current.selectedCommand?.name).toBe('dev');
    expect(onConsumedInitialCommand).toHaveBeenCalledTimes(1);
  });

  describe('keyboard navigation', () => {
    const makeKeyEvent = (key: string): React.KeyboardEvent =>
      ({ key, preventDefault: vi.fn() }) as unknown as React.KeyboardEvent;

    it('ArrowDown increments focusedIndex', () => {
      const { result } = renderHook(() => useProcessesPanelState(defaultOpts));
      expect(result.current.focusedIndex).toBe(0);

      act(() => result.current.handleKeyDown(makeKeyEvent('ArrowDown')));
      expect(result.current.focusedIndex).toBe(1);
    });

    it('ArrowUp wraps to end', () => {
      const { result } = renderHook(() => useProcessesPanelState(defaultOpts));

      act(() => result.current.handleKeyDown(makeKeyEvent('ArrowUp')));
      // 2 workspace groups: '.' and 'apps/api' → items.length = 2, wraps to 1
      expect(result.current.focusedIndex).toBeGreaterThan(0);
    });

    it('Enter selects the focused workspace', () => {
      const onClearRun = vi.fn();
      const { result } = renderHook(() =>
        useProcessesPanelState({ ...defaultOpts, onClearRun })
      );

      act(() => result.current.handleKeyDown(makeKeyEvent('Enter')));

      expect(onClearRun).toHaveBeenCalled();
      expect(result.current.selectedWorkspace).not.toBeNull();
    });
  });
});
