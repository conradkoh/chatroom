import { renderHook, act, waitFor } from '@testing-library/react';
import type { HarnessSessionStatus } from '@workspace/backend/src/domain/direct-harness/types';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useOptimisticSessionClose } from './useOptimisticSessionClose';

const mockCloseSessionMutation = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockCloseSessionMutation,
}));

describe('useOptimisticSessionClose', () => {
  beforeEach(() => {
    mockCloseSessionMutation.mockReset();
    mockCloseSessionMutation.mockResolvedValue(undefined);
  });

  it('adds session to optimisticallyClosedIds immediately on close', async () => {
    const { result } = renderHook(() =>
      useOptimisticSessionClose([{ _id: 's1', status: 'active' }])
    );

    await act(async () => {
      await result.current.closeSession('s1' as never);
    });

    expect(result.current.optimisticallyClosedIds.has('s1')).toBe(true);
  });

  it('clears optimistic id once server reports closed', async () => {
    type Props = { sessions: { _id: string; status: HarnessSessionStatus }[] };
    const initialProps: Props = { sessions: [{ _id: 's1', status: 'active' }] };
    const { result, rerender } = renderHook(
      ({ sessions }: Props) => useOptimisticSessionClose(sessions),
      { initialProps }
    );

    await act(async () => {
      await result.current.closeSession('s1' as never);
    });

    rerender({ sessions: [{ _id: 's1', status: 'closed' }] });

    await waitFor(() => {
      expect(result.current.optimisticallyClosedIds.has('s1')).toBe(false);
    });
  });

  it('reverts optimistic id when mutation fails', async () => {
    mockCloseSessionMutation.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() =>
      useOptimisticSessionClose([{ _id: 's1', status: 'active' }])
    );

    await act(async () => {
      await expect(result.current.closeSession('s1' as never)).rejects.toThrow('network');
    });

    expect(result.current.optimisticallyClosedIds.has('s1')).toBe(false);
  });
});
