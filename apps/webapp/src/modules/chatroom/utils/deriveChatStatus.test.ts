import { describe, expect, it } from 'vitest';

import { deriveChatStatus, type AgentPresence } from './deriveChatStatus';

function agent(overrides: Partial<AgentPresence> = {}): AgentPresence {
  return {
    lastSeenAction: 'get-next-task:started',
    lastStatus: 'agent.waiting',
    lastDesiredState: 'running',
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

  it('returns active when all online agents are waiting (agent.waiting)', () => {
    expect(
      deriveChatStatus('active', [
        agent({ lastStatus: 'agent.waiting' }),
        agent({ lastStatus: 'agent.waiting' }),
      ])
    ).toBe('active');
  });

  it('returns working when an agent is processing a task (task.inProgress)', () => {
    expect(deriveChatStatus('active', [agent({ lastStatus: 'task.inProgress' })])).toBe('working');
  });

  it('returns active when an agent just completed a task (task.completed)', () => {
    expect(deriveChatStatus('active', [agent({ lastStatus: 'task.completed' })])).toBe('active');
  });

  it('returns working when an agent is awaiting handoff (agent.awaitingHandoff)', () => {
    expect(deriveChatStatus('active', [agent({ lastStatus: 'agent.awaitingHandoff' })])).toBe(
      'working'
    );
  });

  it('returns working when mixed waiting + awaitingHandoff', () => {
    expect(
      deriveChatStatus('active', [
        agent({ lastStatus: 'agent.waiting' }),
        agent({ lastStatus: 'agent.awaitingHandoff' }),
      ])
    ).toBe('working');
  });

  it('returns transitioning when an agent just received a task (task.acknowledged)', () => {
    expect(deriveChatStatus('active', [agent({ lastStatus: 'task.acknowledged' })])).toBe(
      'transitioning'
    );
  });

  it('returns transitioning for transitional online states', () => {
    expect(deriveChatStatus('active', [agent({ lastStatus: 'agent.registered' })])).toBe(
      'transitioning'
    );
    expect(deriveChatStatus('active', [agent({ lastStatus: 'agent.requestStart' })])).toBe(
      'transitioning'
    );
  });

  it('non-working / non-awaiting-handoff transitional event types stay transitioning', () => {
    expect(deriveChatStatus('active', [agent({ lastStatus: 'task.acknowledged' })])).toBe(
      'transitioning'
    );
    expect(deriveChatStatus('active', [agent({ lastStatus: 'agent.registered' })])).toBe(
      'transitioning'
    );
  });

  it('returns working when any online agent is working among waiting peers', () => {
    expect(
      deriveChatStatus('active', [
        agent({ lastStatus: 'agent.waiting' }),
        agent({ lastStatus: 'task.inProgress' }),
      ])
    ).toBe('working');
  });

  it('ignores a working status from an offline/exited agent', () => {
    expect(
      deriveChatStatus('active', [
        agent({ lastStatus: 'task.inProgress', lastSeenAction: 'exited', isAlive: false }),
      ])
    ).toBe('idle');
  });

  it('counts isAlive agents as online even when lastSeenAction is exited', () => {
    expect(
      deriveChatStatus('active', [
        agent({ lastSeenAction: 'exited', isAlive: true, lastStatus: 'agent.waiting' }),
      ])
    ).toBe('active');
  });
});
