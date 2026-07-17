import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { useSearchConfigUsage } from './useSearchConfigUsage';

describe('useSearchConfigUsage', () => {
  test('getLastUsed returns null when no usage', () => {
    const { result } = renderHook(() => useSearchConfigUsage('machine-1'));
    expect(result.current.getLastUsed()).toBeNull();
  });

  test('recordUsage then getLastUsed returns the entry', () => {
    const { result } = renderHook(() => useSearchConfigUsage('machine-1'));
    const entry = { harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' };

    act(() => {
      result.current.recordUsage(entry);
    });

    const last = result.current.getLastUsed();
    expect(last).not.toBeNull();
    expect(last?.harnessName).toBe('opencode-sdk');
    expect(last?.modelKey).toBe('openai::gpt-4o');
  });

  test('clearUsage removes entry', () => {
    const { result } = renderHook(() => useSearchConfigUsage('machine-1'));
    const entry = { harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' };

    act(() => {
      result.current.recordUsage(entry);
    });
    expect(result.current.getLastUsed()).not.toBeNull();

    act(() => {
      result.current.clearUsage(entry);
    });
    expect(result.current.getLastUsed()).toBeNull();
  });

  test('returns null when machineId is null', () => {
    const { result } = renderHook(() => useSearchConfigUsage(null));
    expect(result.current.getLastUsed()).toBeNull();
  });
});
