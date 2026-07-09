import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTriggerAutocomplete, type TriggerDefinition } from './useTriggerAutocomplete';
import type { FileEntry } from '../components/FileSelector/useFileSelector';
import { createFileReferenceTrigger } from '../triggers/fileReferenceTrigger';

function createTrigger(onActivate: () => void): TriggerDefinition<string> {
  return {
    triggerChar: '@',
    isValidPosition: () => true,
    isEnabled: () => true,
    getResults: (query) => (query ? [query] : ['alpha']),
    serialize: (item) => item,
    onActivate,
  };
}

function keyDown(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
}

const sampleFiles: FileEntry[] = [
  { path: 'src/a.ts', type: 'file' },
  { path: 'src/b.ts', type: 'file' },
  { path: 'src/c.ts', type: 'file' },
];

describe('useTriggerAutocomplete', () => {
  it('fires onActivate once per visible activation and again after hiding', () => {
    const onActivate = vi.fn();
    const trigger = createTrigger(onActivate);

    const { result } = renderHook(() => useTriggerAutocomplete([trigger]));

    act(() => {
      result.current.handleInputChange('@', 1);
    });
    expect(onActivate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleInputChange('@a', 2);
      result.current.handleInputChange('@ab', 3);
    });
    expect(onActivate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleInputChange('no trigger', 10);
    });
    expect(result.current.state.visible).toBe(false);

    act(() => {
      result.current.handleInputChange('@', 1);
    });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('fires onActivate again after explicit dismiss', () => {
    const onActivate = vi.fn();
    const trigger = createTrigger(onActivate);

    const { result } = renderHook(() => useTriggerAutocomplete([trigger]));

    act(() => {
      result.current.handleInputChange('@', 1);
    });
    expect(onActivate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleDismiss();
      result.current.handleInputChange('@', 1);
    });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('refreshes results when triggers update while @ is active', () => {
    const fileA: FileEntry = { path: 'src/a.ts', type: 'file' };

    const { result, rerender } = renderHook(
      ({ files }: { files: FileEntry[] }) => {
        const trigger = createFileReferenceTrigger(files, { hasWorkspace: true });
        return useTriggerAutocomplete([trigger]);
      },
      { initialProps: { files: [] as FileEntry[] } }
    );

    act(() => {
      result.current.handleInputChange('@', 1);
    });
    expect(result.current.state.visible).toBe(true);
    expect(result.current.state.results).toHaveLength(0);

    act(() => {
      rerender({ files: [fileA] });
    });

    expect(result.current.state.results).toEqual([fileA]);
    expect(result.current.state.visible).toBe(true);
  });

  it('does not loop when triggers refresh while @ is active', () => {
    const fileA: FileEntry = { path: 'src/a.ts', type: 'file' };
    let renderCount = 0;

    const { result, rerender } = renderHook(
      ({ files }: { files: FileEntry[] }) => {
        renderCount += 1;
        const trigger = createFileReferenceTrigger(files, { hasWorkspace: true });
        return useTriggerAutocomplete([trigger]);
      },
      { initialProps: { files: [] as FileEntry[] } }
    );

    act(() => {
      result.current.handleInputChange('@', 1);
    });

    const rendersBeforeFilesLoad = renderCount;

    act(() => {
      rerender({ files: [fileA] });
    });

    expect(renderCount - rendersBeforeFilesLoad).toBeLessThan(5);
    expect(result.current.state.results).toEqual([fileA]);
  });
});

describe('useTriggerAutocomplete keyboard navigation', () => {
  it('moves selection with ArrowDown and ArrowUp immediately after @<query>', () => {
    const trigger = createFileReferenceTrigger(sampleFiles, { hasWorkspace: true });
    const { result } = renderHook(() => useTriggerAutocomplete([trigger]));

    act(() => {
      result.current.handleInputChange('@src', 4);
    });

    expect(result.current.state.visible).toBe(true);
    expect(result.current.state.results.length).toBeGreaterThan(0);
    expect(result.current.state.selectedIndex).toBe(0);

    act(() => {
      expect(result.current.handleKeyDown(keyDown('ArrowDown'))).toBe(true);
    });
    expect(result.current.state.selectedIndex).toBe(1);

    act(() => {
      expect(result.current.handleKeyDown(keyDown('ArrowDown'))).toBe(true);
    });
    expect(result.current.state.selectedIndex).toBe(2);

    act(() => {
      expect(result.current.handleKeyDown(keyDown('ArrowUp'))).toBe(true);
    });
    expect(result.current.state.selectedIndex).toBe(1);
  });

  it('clamps ArrowDown at the last result', () => {
    const trigger = createFileReferenceTrigger(sampleFiles, { hasWorkspace: true });
    const { result } = renderHook(() => useTriggerAutocomplete([trigger]));

    act(() => {
      result.current.handleInputChange('@', 1);
    });

    const lastIndex = result.current.state.results.length - 1;

    act(() => {
      for (let i = 0; i < lastIndex + 3; i++) {
        result.current.handleKeyDown(keyDown('ArrowDown'));
      }
    });

    expect(result.current.state.selectedIndex).toBe(lastIndex);
  });

  it('does not handle arrow keys when autocomplete is open but results are empty', () => {
    const trigger = createFileReferenceTrigger([], { hasWorkspace: true });
    const { result } = renderHook(() => useTriggerAutocomplete([trigger]));

    act(() => {
      result.current.handleInputChange('@', 1);
    });

    expect(result.current.state.visible).toBe(true);
    expect(result.current.state.results).toHaveLength(0);

    act(() => {
      expect(result.current.handleKeyDown(keyDown('ArrowDown'))).toBe(false);
    });
    expect(result.current.state.selectedIndex).toBe(0);
  });

  it('preserves selection index when files load while @ is active', () => {
    const fileA: FileEntry = { path: 'src/a.ts', type: 'file' };
    const fileB: FileEntry = { path: 'src/b.ts', type: 'file' };

    const { result, rerender } = renderHook(
      ({ files }: { files: FileEntry[] }) => {
        const trigger = createFileReferenceTrigger(files, { hasWorkspace: true });
        return useTriggerAutocomplete([trigger]);
      },
      { initialProps: { files: [fileA] as FileEntry[] } }
    );

    act(() => {
      result.current.handleInputChange('@', 1);
      result.current.handleKeyDown(keyDown('ArrowDown'));
    });
    expect(result.current.state.selectedIndex).toBe(0);

    act(() => {
      rerender({ files: [fileA, fileB] });
    });

    expect(result.current.state.results).toHaveLength(2);
    expect(result.current.state.selectedIndex).toBe(0);
  });
});
