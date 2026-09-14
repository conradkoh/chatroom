import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import { projectAgentRoleStatusReadModel } from './project-agent-role-status-read-model';
import { transitionAgentStatus } from './transition-agent-status';

vi.mock('./get-last-sent-launch-request', () => ({
  getLastSentLaunchRequestForRole: vi.fn(),
}));
vi.mock('./project-agent-role-status-read-model', () => ({
  projectAgentRoleStatusReadModel: vi.fn(),
  statusEventForAgentEvent: vi.fn((status: string) => ({
    status: status === 'agent.waiting' ? 'waiting' : 'offline',
  })),
}));

const lookup = vi.mocked(getLastSentLaunchRequestForRole);
const project = vi.mocked(projectAgentRoleStatusReadModel);

describe('transitionAgentStatus', () => {
  beforeEach(() => {
    lookup.mockResolvedValue(null);
    project.mockResolvedValue(undefined);
  });

  it('projects an operational event to the role-status read model', async () => {
    await transitionAgentStatus({} as never, 'room' as never, 'builder', 'agent.waiting');

    expect(project).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        chatroomId: 'room',
        role: 'builder',
        event: { status: 'waiting' },
      })
    );
  });

  it('ignores the deprecated explicit desired state argument', async () => {
    await transitionAgentStatus(
      {} as never,
      'room' as never,
      'builder',
      'agent.waiting',
      'stopped'
    );

    expect(project).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ event: { status: 'waiting' } })
    );
  });

  it('uses an explicit status event when provided', async () => {
    await transitionAgentStatus(
      {} as never,
      'room' as never,
      'builder',
      'agent.exited',
      undefined,
      { status: 'error', errorSource: 'runtime', errorCode: 'agent.exited' }
    );

    expect(project).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        event: { status: 'error', errorSource: 'runtime', errorCode: 'agent.exited' },
      })
    );
  });
});
