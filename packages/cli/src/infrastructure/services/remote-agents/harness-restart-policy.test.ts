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
  return {
    task: {
      taskId: 'test-task-id' as any,
      chatroomId: 'test-chatroom-id' as any,
      status: 'pending',
      assignedTo: 'builder',
      updatedAt: Date.now() - 300_000,
      createdAt: Date.now() - 300_000,
    },
    agentConfig: {
      role: 'builder',
      machineId: 'test-machine-id',
      agentHarness: 'opencode',
      desiredState: 'running',
      circuitState: 'closed',
    },
    ...overrides,
  };
}

function makeAgentEndContext(): AgentEndContext {
  return {
    pendingStops: new Map(),
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

    // ─── in_progress tasks ─────────────────────────────────────────────────────

    it('returns false when in_progress and agent has spawnedAgentPid', () => {
      const params = makeParams({
        task: { ...makeParams().task, status: 'in_progress' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: 12345 },
      });
      expect(policy.shouldStartAgent(params)).toBe(false);
    });

    it('returns true when in_progress but spawnedAgentPid is null (dead agent)', () => {
      const params = makeParams({
        task: { ...makeParams().task, status: 'in_progress' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: undefined },
      });
      expect(policy.shouldStartAgent(params)).toBe(true);
    });

    it('returns false when in_progress + dead agent but desiredState is "stopped"', () => {
      const params = makeParams({
        task: { ...makeParams().task, status: 'in_progress' },
        agentConfig: {
          ...makeParams().agentConfig,
          spawnedAgentPid: undefined,
          desiredState: 'stopped',
        },
      });
      expect(policy.shouldStartAgent(params)).toBe(false);
    });

    it('returns false when in_progress + dead agent but circuitState is "open"', () => {
      const params = makeParams({
        task: { ...makeParams().task, status: 'in_progress' },
        agentConfig: {
          ...makeParams().agentConfig,
          spawnedAgentPid: undefined,
          circuitState: 'open',
        },
      });
      expect(policy.shouldStartAgent(params)).toBe(false);
    });

    // ─── pending/acknowledged tasks with no PID (immediate start) ─────────────

    it('returns true when pending task has no spawnedAgentPid', () => {
      const params = makeParams({
        task: { ...makeParams().task, status: 'pending' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: undefined },
      });
      expect(policy.shouldStartAgent(params)).toBe(true);
    });

    it('returns true when acknowledged task has no spawnedAgentPid', () => {
      const params = makeParams({
        task: { ...makeParams().task, status: 'acknowledged' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: undefined },
      });
      expect(policy.shouldStartAgent(params)).toBe(true);
    });

    it('returns false when pending + no PID but desiredState is "stopped"', () => {
      const params = makeParams({
        task: { ...makeParams().task, status: 'pending' },
        agentConfig: {
          ...makeParams().agentConfig,
          spawnedAgentPid: undefined,
          desiredState: 'stopped',
        },
      });
      expect(policy.shouldStartAgent(params)).toBe(false);
    });

    it('returns false when pending + no PID but circuitState is "open"', () => {
      const params = makeParams({
        task: { ...makeParams().task, status: 'pending' },
        agentConfig: {
          ...makeParams().agentConfig,
          spawnedAgentPid: undefined,
          circuitState: 'open',
        },
      });
      expect(policy.shouldStartAgent(params)).toBe(false);
    });

    // ─── pending/acknowledged tasks with PID (no start) ───────────────────────

    it('returns false when pending task has spawnedAgentPid', () => {
      const params = makeParams({
        task: { ...makeParams().task, status: 'pending' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: 12345 },
      });
      // There's a running agent; we don't start another one
      expect(policy.shouldStartAgent(params)).toBe(false);
    });

    it('returns false when acknowledged task has spawnedAgentPid', () => {
      const params = makeParams({
        task: { ...makeParams().task, status: 'acknowledged' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: 12345 },
      });
      // There's a running agent; we don't start another one
      expect(policy.shouldStartAgent(params)).toBe(false);
    });

    // ─── other statuses ─────────────────────────────────────────────────────────

    it('returns false for other task statuses (e.g., completed)', () => {
      const params = makeParams({
        task: { ...makeParams().task, status: 'completed' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: undefined },
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
      const params = makeParams({
        agentConfig: { ...makeParams().agentConfig, desiredState: 'stopped' },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    it('returns false when circuitState is "open"', () => {
      const context = makeAgentEndContext();
      const params = makeParams({
        agentConfig: { ...makeParams().agentConfig, circuitState: 'open' },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    // ─── in_progress tasks ─────────────────────────────────────────────────────

    it('returns false when in_progress and agent has spawnedAgentPid', () => {
      const context = makeAgentEndContext();
      const params = makeParams({
        task: { ...makeParams().task, status: 'in_progress' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: 12345 },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    it('returns true when in_progress but spawnedAgentPid is null (dead agent)', () => {
      const context = makeAgentEndContext();
      const params = makeParams({
        task: { ...makeParams().task, status: 'in_progress' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: undefined },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(true);
    });

    it('returns false when in_progress + dead agent but desiredState is "stopped"', () => {
      const context = makeAgentEndContext();
      const params = makeParams({
        task: { ...makeParams().task, status: 'in_progress' },
        agentConfig: {
          ...makeParams().agentConfig,
          spawnedAgentPid: undefined,
          desiredState: 'stopped',
        },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    it('returns false when in_progress + dead agent but circuitState is "open"', () => {
      const context = makeAgentEndContext();
      const params = makeParams({
        task: { ...makeParams().task, status: 'in_progress' },
        agentConfig: {
          ...makeParams().agentConfig,
          spawnedAgentPid: undefined,
          circuitState: 'open',
        },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    // ─── pending/acknowledged tasks with no PID (immediate start) ─────────────

    it('returns true when pending task has no spawnedAgentPid', () => {
      const context = makeAgentEndContext();
      const params = makeParams({
        task: { ...makeParams().task, status: 'pending' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: undefined },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(true);
    });

    it('returns true when acknowledged task has no spawnedAgentPid', () => {
      const context = makeAgentEndContext();
      const params = makeParams({
        task: { ...makeParams().task, status: 'acknowledged' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: undefined },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(true);
    });

    it('returns false when pending + no PID but desiredState is "stopped"', () => {
      const context = makeAgentEndContext();
      const params = makeParams({
        task: { ...makeParams().task, status: 'pending' },
        agentConfig: {
          ...makeParams().agentConfig,
          spawnedAgentPid: undefined,
          desiredState: 'stopped',
        },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    it('returns false when pending + no PID but circuitState is "open"', () => {
      const context = makeAgentEndContext();
      const params = makeParams({
        task: { ...makeParams().task, status: 'pending' },
        agentConfig: {
          ...makeParams().agentConfig,
          spawnedAgentPid: undefined,
          circuitState: 'open',
        },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    // ─── pending/acknowledged tasks with PID (require pendingStops) ─────────

    it('returns false when pending task has spawnedAgentPid and no pendingStops context', () => {
      const params = makeParams({
        task: { ...makeParams().task, status: 'pending' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: 12345 },
      });
      expect(policy.shouldStartAgent(params)).toBe(false);
    });

    it('returns false when pending task has spawnedAgentPid and pendingStops not set', () => {
      const context = makeAgentEndContext();
      const params = makeParams({
        task: { ...makeParams().task, status: 'pending' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: 12345 },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    it('returns false when pending task has spawnedAgentPid and pendingStops is agent_process.turn_end_quick_fail', () => {
      const context = makeAgentEndContext();
      context.pendingStops.set('test-chatroom-id:builder', 'agent_process.turn_end_quick_fail');
      const params = makeParams({
        task: { ...makeParams().task, status: 'pending' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: 12345 },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(false);
    });

    it('returns true when pending task has spawnedAgentPid and pendingStops is agent_process.turn_end', () => {
      const context = makeAgentEndContext();
      context.pendingStops.set('test-chatroom-id:builder', 'agent_process.turn_end');
      const params = makeParams({
        task: { ...makeParams().task, status: 'pending' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: 12345 },
      });
      expect(policy.shouldStartAgent(params, context)).toBe(true);
    });

    // ─── role key lookup ──────────────────────────────────────────────────────

    it('uses lowercase role for pendingStops key lookup', () => {
      const context = makeAgentEndContext();
      context.pendingStops.set('test-chatroom-id:builder', 'agent_process.turn_end');
      const params = makeParams({
        task: { ...makeParams().task, status: 'pending' },
        agentConfig: { ...makeParams().agentConfig, role: 'Builder', spawnedAgentPid: 12345 },
      });
      // Key is built using role.toLowerCase()
      expect(policy.shouldStartAgent(params, context)).toBe(true);
    });

    // ─── other statuses ───────────────────────────────────────────────────────

    it('returns false for other task statuses (e.g., completed)', () => {
      const context = makeAgentEndContext();
      const params = makeParams({
        task: { ...makeParams().task, status: 'completed' },
        agentConfig: { ...makeParams().agentConfig, spawnedAgentPid: undefined },
      });
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
