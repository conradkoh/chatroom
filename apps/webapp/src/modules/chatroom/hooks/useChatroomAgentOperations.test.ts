import { renderHook, act } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { useChatroomAgentOperations } from './useChatroomAgentOperations';

const requestOperation = vi.fn().mockResolvedValue({
  requested: [],
  skipped: [],
  failed: [],
  commandIds: [],
});

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => requestOperation,
}));
vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    agents: {
      requestChatroomAgentOperation: 'chatroom-operation',
    },
  },
}));

describe('useChatroomAgentOperations', () => {
  test.each([
    ['startAgents', 'start'],
    ['stopAgents', 'stop'],
    ['restartAgents', 'restart'],
  ] as const)('maps %s to the chatroom operation %s', async (action, operation) => {
    const { result } = renderHook(() => useChatroomAgentOperations());

    await act(() => result.current[action]('room' as never));

    expect(requestOperation).toHaveBeenCalledWith({ chatroomId: 'room', operation });
    requestOperation.mockClear();
  });
});
