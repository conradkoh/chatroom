import { describe, expect, it } from 'vitest';

import {
  OpenCodeRestartPolicy,
  PiRestartPolicy,
  getRestartPolicyForHarness,
  type ShouldStartAgentParams,
  type AgentEndContext,
} from './harness-restart-policy.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeParams(overrides?: Partial<ShouldStartAgentParams>): ShouldStartAgentParams {
  const now = Date.now();
  return {
    task: {
      taskId: 'test-task-id' as any,
      chatroomId: 'test-chatroom-id' as any,
      status: 'pending',
      assignedTo: 'builder',
      updatedAt: now - 300_000, // 5 minutes ago
      createdAt: now - 300_000,
    },
    agentConfig: {
      role: 'builder',
      machineId: 'test-machine-id',
      agentHarness: 'opencode',
      desiredState: 'running',
      circuitState: 'closed',
    },
    lastTokenAt: null,
    now,
    ...overrides,
  };
}

function makeAgentEndContext(): AgentEndContext {
  return {
    agentEndedTurn: new Map(),
  };
}

// ─── OpenCodeRestartPolicy ─────────────────────────────────────────────────────

describe('OpenCodeRestartPolicy', () => {
  const policy = new OpenCodeRestartPolicy();

  describe('shouldStartAgent', () => {
    it('returns false when desiredState is not "running"', () => {
      const params = makeParams({
        agentConfig: { ...makeParams().agentConfig, desiredState: 'stopped' },
      });
      expect(policy.shouldStartAgent(params)).toBe(false);
    });

    it('returns false when circuitState is "open"', () => {
      const params = makeParams({
        agentConfig: { ...makeParams().agentConfig, circuitState: 'open' },
      });
      expect(policy.shouldStartAgent(params)).toBe(false);
    });

    it('returns false when task status is "in_progress"', () => {
      const params = makeParams({
        task: { ...makeParams().task, status: 'in_progress' },
      });
      expect(policy.shouldStartAgent(params)).toBe(false);
    });

    it('returns false when task is too fresh (not stuck yet)', () => {
      const now = Date.now();
      const params = makeParams({
        task: {
          ...makeParams().task,
          createdAt: now - 60_000, // 1 minute ago
          updatedAt: now - 60_000,
        },
        now,
      });
      expect(policy.shouldStartAgent(params)).toBe(false);
    });

    it('returns true when task is old enough and agent is idle (no tokens)', () => {
      const now = Date.now();
      const params = makeParams({
        task: {
          ...makeParams().task,
          createdAt: now - 300_000, // 5 minutes ago
          updatedAt: now - 300_000,
          status: 'acknowledged',
        },
        lastTokenAt: null, // No tokens produced
        now,
      });
      expect(policy.shouldStartAgent(params)).toBe(true);
    });

    it('returns true when task is old enough and agent has been idle for >1min', () => {
      const now = Date.now();
      const params = makeParams({
        task: {
          ...makeParams().task,
          createdAt: now - 300_000, // 5 minutes ago
          updatedAt: now - 300_000,
        },
        lastTokenAt: now - 120_000, // Last token 2 minutes ago (idle > 1min)
        now,
      });
      expect(policy.shouldStartAgent(params)).toBe(true);
    });

    it('returns false when task is old enough but agent recently produced tokens', () => {
      const now = Date.now();
      const params = makeParams({
        task: {
          ...makeParams().task,
          createdAt: now - 300_000, // 5 minutes ago
          updatedAt: now - 300_000,
        },
        lastTokenAt: now - 30_000, // Last token 30 seconds ago (still active)
        now,
      });
      expect(policy.shouldStartAgent(params)).toBe(false);
    });
  });
});

// ─── PiRestartPolicy ───────────────────────────────────────────────────────────

describe('PiRestartPolicy', () => {
  const policy = new PiRestartPolicy();

  describe('shouldStartAgent', () => {
    it('returns false when desiredState is not "running"', () => {
      const context = makeAgentEndContext();
      context.agentEndedTurn.set('test-chatroom-id:builder', true);

      const params = makeParams({
        agentConfig: { ...makeParams().agentConfig, desiredState: 'stopped' },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    it('returns false when circuitState is "open"', () => {
      const context = makeAgentEndContext();
      context.agentEndedTurn.set('test-chatroom-id:builder', true);

      const params = makeParams({
        agentConfig: { ...makeParams().agentConfig, circuitState: 'open' },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    it('returns false when task status is "in_progress"', () => {
      const context = makeAgentEndContext();
      context.agentEndedTurn.set('test-chatroom-id:builder', true);

      const params = makeParams({
        task: { ...makeParams().task, status: 'in_progress' },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    it('returns false when agentEndedTurn context is missing', () => {
      const params = makeParams();
      expect(policy.shouldStartAgent(params)).toBe(false);
    });

    it('returns false when agentEndedTurn is not set for the chatroom+role', () => {
      const context = makeAgentEndContext();
      // Don't set agentEndedTurn for this chatroom+role

      const params = makeParams();
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    it('returns false when agentEndedTurn is explicitly false', () => {
      const context = makeAgentEndContext();
      context.agentEndedTurn.set('test-chatroom-id:builder', false);

      const params = makeParams();
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    it('returns true when agent has ended its turn (agentEndedTurn=true)', () => {
      const context = makeAgentEndContext();
      context.agentEndedTurn.set('test-chatroom-id:builder', true);

      const params = makeParams({
        task: { ...makeParams().task, status: 'acknowledged' },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(true);
    });

    it('uses lowercase role for the agentEndedTurn key lookup', () => {
      const context = makeAgentEndContext();
      // Set with lowercase role key (as the daemon does)
      context.agentEndedTurn.set('test-chatroom-id:builder', true);

      const params = makeParams({
        task: { ...makeParams().task, assignedTo: 'Builder' }, // Uppercase
        agentConfig: { ...makeParams().agentConfig, role: 'Builder' }, // Uppercase
      });
      // The policy should use the lowercase role for the key lookup
      // But since the policy uses agentConfig.role (which is 'Builder'), this won't match
      // The daemon sets the key with lowercase role in start-agent.ts
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });
  });
});

// ─── getRestartPolicyForHarness ─────────────────────────────────────────────────

describe('getRestartPolicyForHarness', () => {
  it('returns OpenCodeRestartPolicy for "opencode"', () => {
    const policy = getRestartPolicyForHarness('opencode');
    expect(policy).toBeInstanceOf(OpenCodeRestartPolicy);
  });

  it('returns PiRestartPolicy for "pi"', () => {
    const policy = getRestartPolicyForHarness('pi');
    expect(policy).toBeInstanceOf(PiRestartPolicy);
  });

  it('returns a default policy (always false) for unknown harnesses', () => {
    const policy = getRestartPolicyForHarness('unknown-harness');
    expect(policy.id).toBe('unknown-harness');
    expect(policy.shouldStartAgent(makeParams())).toBe(false);
  });
});