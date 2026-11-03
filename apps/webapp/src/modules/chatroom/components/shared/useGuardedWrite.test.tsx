import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useGuardedWrite } from './useGuardedWrite';

function mapError(error: unknown): string {
  return `mapped:${(error as { code?: string }).code ?? 'unknown'}`;
}

describe('useGuardedWrite', () => {
  it('ignores a second run while one is in flight', async () => {
    let resolveFirst: (() => void) | undefined;
    const fn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        })
    );
    const { result } = renderHook(() => useGuardedWrite(mapError));

    let first: Promise<void> | undefined;
    act(() => {
      first = result.current.run(fn);
    });

    await act(async () => {
      await result.current.run(fn);
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(true);

    await act(async () => {
      resolveFirst?.();
      await first;
    });

    expect(result.current.pending).toBe(false);
  });

  it('exposes a mapped error and clears it on the next run', async () => {
    const { result } = renderHook(() => useGuardedWrite(mapError));

    await act(async () => {
      await result.current.run(() => Promise.reject({ code: 'SCHEDULE_FINISHED' }));
    });

    expect(result.current.error).toBe('mapped:SCHEDULE_FINISHED');

    await act(async () => {
      await result.current.run(() => Promise.resolve());
    });

    expect(result.current.error).toBeNull();
  });
});
