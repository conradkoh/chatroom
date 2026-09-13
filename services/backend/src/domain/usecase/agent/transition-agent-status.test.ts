import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transitionAgentStatus } from './transition-agent-status';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';

vi.mock('../machine/assigned-tasks-core', () => ({ getParticipantForChatroomRole: vi.fn() }));
const lookup = vi.mocked(getParticipantForChatroomRole);
function ctx(config?: { desiredState?: string | undefined }): any {
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
  it('updates only the participant status mirror', async () => {
    const c = ctx({ desiredState: 'running' });
    await transitionAgentStatus(c, 'room' as never, 'builder', 'agent.waiting');
    expect(c.db.patch).toHaveBeenCalledWith('chatroom_participants', 'participant', {
      lastStatus: 'agent.waiting',
    });
  });
  it('ignores the deprecated explicit desired state argument', async () => {
    const c = ctx({ desiredState: 'running' });
    await transitionAgentStatus(c, 'room' as never, 'builder', 'agent.waiting', 'stopped');
    expect(c.db.patch).toHaveBeenCalledWith('chatroom_participants', 'participant', {
      lastStatus: 'agent.waiting',
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
