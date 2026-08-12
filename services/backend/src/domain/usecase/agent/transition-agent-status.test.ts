import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transitionAgentStatus } from './transition-agent-status';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';

vi.mock('../machine/assigned-tasks-core', () => ({
  getParticipantForChatroomRole: vi.fn(),
}));

const lookup = vi.mocked(getParticipantForChatroomRole);

function context(): { db: { patch: ReturnType<typeof vi.fn> } } {
  return { db: { patch: vi.fn() } };
}

describe('transitionAgentStatus', () => {
  beforeEach(() => lookup.mockReset());

  it('updates a normal participant for waiting', async () => {
    lookup.mockResolvedValue({ _id: 'participant-1', lastStatus: 'agent.running' } as never);
    const ctx = context();
    await transitionAgentStatus(ctx as never, 'room-1' as never, 'builder', 'agent.waiting');
    expect(ctx.db.patch).toHaveBeenCalledWith('chatroom_participants', 'participant-1', {
      lastStatus: 'agent.waiting',
    });
  });

  it('preserves provider unavailable over waiting', async () => {
    lookup.mockResolvedValue({
      _id: 'participant-1',
      lastStatus: 'agent.providerUnavailable',
    } as never);
    const ctx = context();
    await transitionAgentStatus(ctx as never, 'room-1' as never, 'builder', 'agent.waiting');
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('updates desired state while preserving sticky status', async () => {
    lookup.mockResolvedValue({ _id: 'participant-1', lastStatus: 'agent.circuitOpen' } as never);
    const ctx = context();
    await transitionAgentStatus(
      ctx as never,
      'room-1' as never,
      'builder',
      'agent.waiting',
      'stopped'
    );
    expect(ctx.db.patch).toHaveBeenCalledWith('chatroom_participants', 'participant-1', {
      lastDesiredState: 'stopped',
    });
  });

  it('allows non-waiting transitions to overwrite sticky status', async () => {
    lookup.mockResolvedValue({ _id: 'participant-1', lastStatus: 'agent.startFailed' } as never);
    const ctx = context();
    await transitionAgentStatus(ctx as never, 'room-1' as never, 'builder', 'task.inProgress');
    expect(ctx.db.patch).toHaveBeenCalledWith('chatroom_participants', 'participant-1', {
      lastStatus: 'task.inProgress',
    });
  });
});
