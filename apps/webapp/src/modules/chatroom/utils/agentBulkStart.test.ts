import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { describe, expect, it, vi } from 'vitest';

import { getFailedAgentRoles, startAgentsForRoles } from './agentBulkStart';
import type { AgentConfig, SendCommandFn } from '../types/machine';

const chatroomId = 'chatroom-1' as Id<'chatroom_rooms'>;

const baseConfig: AgentConfig = {
  machineId: 'machine-a',
  hostname: 'host-a',
  role: 'builder',
  agentType: 'cursor',
  workingDir: '/proj',
  model: 'auto',
  availableHarnesses: ['cursor'],
  updatedAt: 1,
  wantResume: true,
};

describe('getFailedAgentRoles', () => {
  it('returns roles for rejected results', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: true },
      { status: 'rejected', reason: new Error('boom') },
    ];

    expect(getFailedAgentRoles(results, ['planner', 'builder'])).toEqual(['builder']);
  });
});

describe('startAgentsForRoles', () => {
  it('uses config.wantResume when no override is provided', async () => {
    const sendCommand = vi.fn<SendCommandFn>().mockResolvedValue(undefined);
    const roleConfigMap = new Map<string, AgentConfig>([
      ['builder', { ...baseConfig, role: 'builder' }],
    ]);

    await startAgentsForRoles(['builder'], roleConfigMap, chatroomId, sendCommand);

    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'start-agent',
        payload: expect.objectContaining({ wantResume: true }),
      })
    );
  });

  it('sends wantResume: false when override is passed', async () => {
    const sendCommand = vi.fn<SendCommandFn>().mockResolvedValue(undefined);
    const roleConfigMap = new Map<string, AgentConfig>([
      ['builder', { ...baseConfig, role: 'builder', wantResume: true }],
    ]);

    await startAgentsForRoles(['builder'], roleConfigMap, chatroomId, sendCommand, {
      wantResume: false,
    });

    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'start-agent',
        payload: expect.objectContaining({ wantResume: false }),
      })
    );
  });

  it('sends wantResume: true when override is passed as true', async () => {
    const sendCommand = vi.fn<SendCommandFn>().mockResolvedValue(undefined);
    const roleConfigMap = new Map<string, AgentConfig>([
      ['builder', { ...baseConfig, role: 'builder', wantResume: false }],
    ]);

    await startAgentsForRoles(['builder'], roleConfigMap, chatroomId, sendCommand, {
      wantResume: true,
    });

    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'start-agent',
        payload: expect.objectContaining({ wantResume: true }),
      })
    );
  });
});
