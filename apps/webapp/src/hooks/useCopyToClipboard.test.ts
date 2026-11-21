import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCopyToClipboard } from './useCopyToClipboard';

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useCopyToClipboard', () => {
  it('marks the key as copied on success and reverts after 2 s', async () => {
    const { result } = renderHook(() => useCopyToClipboard());

    let ok = false;
    await act(async () => {
      ok = await result.current.copy('ABCD2345', 'recovery');
    });
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('ABCD2345');
    expect(result.current.copiedKey).toBe('recovery');
    expect(result.current.failedKey).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(result.current.copiedKey).toBe('recovery');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copiedKey).toBeNull();
  });

  it('keeps the failed key on rejection, logs the error, and clears it on the next copy', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeText.mockRejectedValueOnce(new Error('denied'));
    const { result } = renderHook(() => useCopyToClipboard());

    let ok = true;
    await act(async () => {
      ok = await result.current.copy('ABCD2345', 'recovery');
    });
    expect(ok).toBe(false);
    expect(consoleError).toHaveBeenCalled();
    expect(result.current.failedKey).toBe('recovery');
    expect(result.current.copiedKey).toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.failedKey).toBe('recovery');

    await act(async () => {
      await result.current.copy('ABCD2345', 'recovery');
    });
    expect(result.current.failedKey).toBeNull();
    expect(result.current.copiedKey).toBe('recovery');
  });

  it('clears the pending revert timer on unmount', async () => {
    const { result, unmount } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('ABCD2345', 'recovery');
    });
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts no revert timer when the write resolves after unmount', async () => {
    let resolveWrite!: () => void;
    writeText.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveWrite = resolve;
      })
    );
    const { result, unmount } = renderHook(() => useCopyToClipboard());

    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.copy('ABCD2345', 'recovery');
    });
    unmount();

    await act(async () => {
      resolveWrite();
      await pending;
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
