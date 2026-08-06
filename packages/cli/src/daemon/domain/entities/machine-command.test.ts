import { describe, expect, test } from 'vitest';

import { isStartAgentCommand, isStopAgentCommand, type MachineCommand } from './machine-command.js';

describe('machine-command', () => {
  const startCmd: MachineCommand = {
    type: 'start-agent',
    reason: 'user-request',
    payload: {
      chatroomId: 'room1',
      role: 'builder',
      agentHarness: 'cursor',
    },
  };

  const stopCmd: MachineCommand = {
    type: 'stop-agent',
    reason: 'user-request',
    payload: {
      chatroomId: 'room1',
      role: 'builder',
    },
  };

  test('isStartAgentCommand narrows start-agent', () => {
    expect(isStartAgentCommand(startCmd)).toBe(true);
    expect(isStartAgentCommand(stopCmd)).toBe(false);
  });

  test('isStopAgentCommand narrows stop-agent', () => {
    expect(isStopAgentCommand(stopCmd)).toBe(true);
    expect(isStopAgentCommand(startCmd)).toBe(false);
  });
});
