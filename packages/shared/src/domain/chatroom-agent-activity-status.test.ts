import { describe, expect, it } from 'vitest';

import {
  hasActiveChatroomAgent,
  isChatroomAgentActivityOnline,
  type ChatroomAgentActivityStatusValue,
} from './chatroom-agent-activity-status';

describe('isChatroomAgentActivityOnline', () => {
  const truthTable: [ChatroomAgentActivityStatusValue, boolean][] = [
    ['offline', false],
    ['starting', true],
    ['waiting', true],
    ['working', true],
    ['stopping', true],
    ['error', false],
  ];

  it.each(truthTable)('%s is online: %s', (status, expected) => {
    expect(isChatroomAgentActivityOnline(status)).toBe(expected);
  });
});

describe('hasActiveChatroomAgent', () => {
  it('is false when there are no agents', () => {
    expect(hasActiveChatroomAgent([])).toBe(false);
  });

  it('is false when every agent is error or offline', () => {
    expect(hasActiveChatroomAgent([{ status: 'error' }, { status: 'offline' }])).toBe(false);
  });

  it('is true when one agent is active alongside an error agent', () => {
    expect(hasActiveChatroomAgent([{ status: 'error' }, { status: 'starting' }])).toBe(true);
  });
});
