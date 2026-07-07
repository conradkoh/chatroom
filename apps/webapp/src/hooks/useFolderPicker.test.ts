import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFolderPicker } from './useFolderPicker';

const mockRequestFolderPicker = vi.fn();
const mockUseSessionQuery = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockRequestFolderPicker,
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machines: {
      requestFolderPicker: 'machines:requestFolderPicker',
      getFolderPickerRequest: 'machines:getFolderPickerRequest',
    },
  },
}));

const REQUEST_ID = 'jd7testfolderpicker00000000001';
const FIVE_MINUTES_MS = 5 * 60_000;

describe('useFolderPicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRequestFolderPicker.mockReset();
    mockUseSessionQuery.mockReset();
    mockUseSessionQuery.mockReturnValue(undefined);
    mockRequestFolderPicker.mockResolvedValue({ requestId: REQUEST_ID });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets isTimedOut immediately when pending request already exceeded timeout', async () => {
    const { result, rerender } = renderHook(() => useFolderPicker());

    await act(async () => {
      await result.current.pickFolder('machine-1');
    });

    mockUseSessionQuery.mockReturnValue({
      status: 'pending',
      createdAt: Date.now() - FIVE_MINUTES_MS - 1,
    });
    rerender();

    expect(result.current.isTimedOut).toBe(true);
    expect(result.current.isPending).toBe(false);
  });

  it('sets isTimedOut after remaining timeout elapses', async () => {
    const { result, rerender } = renderHook(() => useFolderPicker());

    await act(async () => {
      await result.current.pickFolder('machine-1');
    });

    mockUseSessionQuery.mockReturnValue({
      status: 'pending',
      createdAt: Date.now() - 1_000,
    });
    rerender();

    expect(result.current.isTimedOut).toBe(false);
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(FIVE_MINUTES_MS);
    });

    expect(result.current.isTimedOut).toBe(true);
    expect(result.current.isPending).toBe(false);
  });

  it('reset clears request id and timeout state', async () => {
    const { result, rerender } = renderHook(() => useFolderPicker());

    await act(async () => {
      await result.current.pickFolder('machine-1');
    });

    mockUseSessionQuery.mockReturnValue({
      status: 'pending',
      createdAt: Date.now() - FIVE_MINUTES_MS - 1,
    });
    rerender();

    expect(result.current.isTimedOut).toBe(true);

    act(() => {
      result.current.reset();
    });

    expect(result.current.requestId).toBeNull();
    expect(result.current.isTimedOut).toBe(false);
    expect(result.current.isPending).toBe(false);
  });
});
