import { renderHook, act } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { useAgentStop } from './useAgentStop';

const requestAgent = vi.fn().mockResolvedValue({ commandIds: ['agent-stop'] });
const requestChatroom = vi.fn().mockResolvedValue({ commandIds: ['chatroom-stop'] });

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (mutation: unknown) =>
    mutation === 'agent' ? requestAgent : requestChatroom,
}));
vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatroomWorkspaceAgentCommandsInbox: {
      requestStopAgent: 'agent',
      requestStopAll: 'chatroom',
    },
  },
}));

describe('useAgentStop', () => {
  test('requests one agent aggregate stop', async () => {
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

  test('requests one chatroom aggregate stop', async () => {
    const { result } = renderHook(() => useAgentStop());
    await act(() => result.current.requestChatroomStop('room' as never));
    expect(requestChatroom).toHaveBeenCalledWith({ chatroomId: 'room' });
  });
});
