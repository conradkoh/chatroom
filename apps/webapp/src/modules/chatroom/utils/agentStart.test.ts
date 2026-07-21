import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { describe, expect, it, vi } from 'vitest';

import { dispatchStartAgent, startAgentsBatch, type StartAgentInput } from './agentStart';
import type { SendCommandFn } from '../types/machine';

const chatroomId = 'chatroom-1' as Id<'chatroom_rooms'>;

const baseInput: StartAgentInput = {
  machineId: 'machine-a',
  chatroomId,
  role: 'builder',
  agentHarness: 'cursor',
  model: 'auto',
  workingDir: '/proj',
};

describe('dispatchStartAgent', () => {
  it('sends a start-agent command with required fields', async () => {
    const sendCommand = vi.fn<SendCommandFn>().mockResolvedValue(undefined);
    await dispatchStartAgent(sendCommand, baseInput);
    expect(sendCommand).toHaveBeenCalledWith({
      machineId: 'machine-a',
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        agentHarness: 'cursor',
        model: 'auto',
        workingDir: '/proj',
      },
    });
  });

  it('omits empty model and trims workingDir', async () => {
    const sendCommand = vi.fn<SendCommandFn>().mockResolvedValue(undefined);
    await dispatchStartAgent(sendCommand, {
      ...baseInput,
      model: '',
      workingDir: '  /trimmed  ',
    });
    expect(sendCommand).toHaveBeenCalledWith({
      machineId: 'machine-a',
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        agentHarness: 'cursor',
        workingDir: '/trimmed',
      },
    });
  });

  it('includes wantResume and allowNewMachine when set', async () => {
    const sendCommand = vi.fn<SendCommandFn>().mockResolvedValue(undefined);
    await dispatchStartAgent(sendCommand, {
      ...baseInput,
      wantResume: false,
      allowNewMachine: true,
    });
    expect(sendCommand).toHaveBeenCalledWith({
      machineId: 'machine-a',
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        agentHarness: 'cursor',
        model: 'auto',
        workingDir: '/proj',
        wantResume: false,
        allowNewMachine: true,
      },
    });
  });
});

describe('startAgentsBatch', () => {
  it('dispatches start commands for each role with config', async () => {
    const sendCommand = vi.fn<SendCommandFn>().mockResolvedValue(undefined);
    const results = await startAgentsBatch(
      ['planner', 'builder'],
      (role) =>
        role === 'builder'
          ? { ...baseInput, role: 'builder' }
          : { ...baseInput, role: 'planner', model: 'gpt-4' },
      sendCommand
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(sendCommand).toHaveBeenCalledTimes(2);
  });

  it('skips roles with no config', async () => {
    const sendCommand = vi.fn<SendCommandFn>().mockResolvedValue(undefined);
    const results = await startAgentsBatch(
      ['planner', 'builder'],
      (role) => (role === 'builder' ? { ...baseInput, role: 'builder' } : null),
      sendCommand
    );

    expect(results).toHaveLength(2);
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });
});
