import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';
import { transitionAgentStatus } from './transition-agent-status';
vi.mock('../machine/assigned-tasks-core', () => ({ getParticipantForChatroomRole: vi.fn() }));
const lookup = vi.mocked(getParticipantForChatroomRole);
function ctx(config?: { desiredState?: string }): any {
  return {
    db: {
      patch: vi.fn(),
      get: vi.fn(async () => ({ _id: 'room', teamId: 'duo' })),
      query: vi.fn(() => ({ withIndex: vi.fn(() => ({ first: vi.fn(async () => config) })) })),
    },
  };
}
describe('transitionAgentStatus', () => {
  beforeEach(() =>
    lookup.mockResolvedValue({
      _id: 'participant',
      lastStatus: 'agent.waiting',
      lastDesiredState: 'stopped',
    } as never)
  );
  it('syncs operational status from team config', async () => {
    const c = ctx({ desiredState: 'running' });
    await transitionAgentStatus(c, 'room' as never, 'builder', 'agent.waiting');
    expect(c.db.patch).toHaveBeenCalledWith('chatroom_participants', 'participant', {
      lastStatus: 'agent.waiting',
      lastDesiredState: 'running',
    });
  });
  it('respects explicit desired state', async () => {
    const c = ctx({ desiredState: 'running' });
    await transitionAgentStatus(c, 'room' as never, 'builder', 'agent.waiting', 'stopped');
    expect(c.db.patch).toHaveBeenCalledWith('chatroom_participants', 'participant', {
      lastStatus: 'agent.waiting',
      lastDesiredState: 'stopped',
    });
  });
  it('does not sync non-operational statuses', async () => {
    const c = ctx({ desiredState: 'running' });
    await transitionAgentStatus(c, 'room' as never, 'builder', 'agent.exited');
    expect(c.db.patch).toHaveBeenCalledWith('chatroom_participants', 'participant', {
      lastStatus: 'agent.exited',
    });
  });
});
