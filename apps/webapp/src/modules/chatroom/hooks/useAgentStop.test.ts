import { renderHook, act } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { useAgentStop } from './useAgentStop';

const requestAgent = vi.fn().mockResolvedValue({ commandIds: ['agent-stop'] });

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => requestAgent,
}));
vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    agents: {
      requestStop: 'agent',
    },
  },
}));

describe('useAgentStop', () => {
  test('requests one agent stop', async () => {
    const { result } = renderHook(() => useAgentStop());
    await act(() =>
      result.current.requestAgentStop({
        chatroomId: 'room' as never,
        machineId: 'machine',
        role: 'builder',
      })
    );
    expect(requestAgent).toHaveBeenCalledWith({
      chatroomId: 'room',
      machineId: 'machine',
      role: 'builder',
    });
  });
});
