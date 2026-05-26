import { describe, expect, it } from 'vitest';

import { deriveChatStatus, type AgentPresence } from './deriveChatStatus';

function agent(overrides: Partial<AgentPresence> = {}): AgentPresence {
  return {
    lastSeenAction: 'get-next-task:started',
    isAlive: true,
    ...overrides,
  };
}

describe('deriveChatStatus', () => {
  it('returns completed for completed chatrooms', () => {
    expect(deriveChatStatus('completed', [agent()])).toBe('completed');
  });

  it('returns idle when no online agents', () => {
    expect(deriveChatStatus('active', [])).toBe('idle');
    expect(deriveChatStatus('active', [agent({ lastSeenAction: 'exited', isAlive: false })])).toBe(
      'idle'
    );
  });

  it('returns idle when all online agents are waiting on get-next-task', () => {
    expect(
      deriveChatStatus('active', [
        agent({ lastSeenAction: 'get-next-task:started' }),
        agent({ lastSeenAction: 'get-next-task:started' }),
      ])
    ).toBe('idle');
  });

  it('returns working when an agent has a non-wait action', () => {
    expect(deriveChatStatus('active', [agent({ lastSeenAction: 'task read' })])).toBe('working');
  });

  it('returns active when agents are online but not all waiting and not working', () => {
    expect(
      deriveChatStatus('active', [
        agent({ lastSeenAction: 'get-next-task:started' }),
        agent({ lastSeenAction: null }),
      ])
    ).toBe('active');
  });
});
