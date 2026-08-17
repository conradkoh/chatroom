import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRequestWorkspaceFileTree } from './useRequestWorkspaceFileTree';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mocks.error(...args) } }));
vi.mock('convex-helpers/react/sessions', () => ({ useSessionMutation: () => mocks.mutate }));
vi.mock('@/lib/workspaceIdentifier', () => ({ normalizeWorkspaceWorkingDir: (d: string) => d }));

describe('useRequestWorkspaceFileTree', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows toast when mutation rejects', async () => {
    mocks.mutate.mockRejectedValue(new Error('Authentication required'));
    const { result } = renderHook(() =>
      useRequestWorkspaceFileTree({ machineId: 'm1', workingDir: '/repo' })
    );
    await act(async () => {
      result.current(true);
      await Promise.resolve();
    });
    expect(mocks.error).toHaveBeenCalledWith('Authentication required');
  });

  it('does not call mutation when disabled', () => {
    const { result } = renderHook(() =>
      useRequestWorkspaceFileTree({ machineId: 'm1', workingDir: '/repo', enabled: false })
    );
    act(() => result.current(true));
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
