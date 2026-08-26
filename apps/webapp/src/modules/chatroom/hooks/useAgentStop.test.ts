import { renderHook, act } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { isActiveAgentStopState, useAgentStop } from './useAgentStop';

const requestAgent = vi.fn().mockResolvedValue({ stopCommandId: 'agent-stop' });
const requestChatroom = vi.fn().mockResolvedValue({ stopCommandId: 'chatroom-stop' });

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (mutation: unknown) =>
    mutation === 'agent' ? requestAgent : requestChatroom,
}));
vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { agentStops: { requestAgent: 'agent', requestChatroom: 'chatroom' } },
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
      reason: 'user.stop',
    });
  });

  test('requests one chatroom aggregate stop', async () => {
    const { result } = renderHook(() => useAgentStop());
    await act(() => result.current.requestChatroomStop('room' as never));
    expect(requestChatroom).toHaveBeenCalledWith({ chatroomId: 'room', reason: 'user.stop' });
  });

  test('recognizes active projected states', () => {
    expect(isActiveAgentStopState('pending')).toBe(true);
    expect(isActiveAgentStopState('stopping')).toBe(true);
    expect(isActiveAgentStopState('failed')).toBe(false);
    expect(isActiveAgentStopState('stopped')).toBe(false);
    expect(isActiveAgentStopState(undefined)).toBe(false);
  });
});
