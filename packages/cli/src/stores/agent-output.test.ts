/**
 * Agent Output Store Unit Tests
 *
 * Tests for the AgentOutputStore class:
 * - recordOutput: records timestamps correctly
 * - getLastOutputTimestamp: retrieves timestamps
 * - isIdle: correctly identifies idle agents based on threshold
 * - getTrackedAgents: returns all tracked agents
 * - remove: stops tracking an agent
 */

import { describe, expect, it } from 'vitest';

import { AgentOutputStore } from './agent-output.js';

describe('AgentOutputStore', () => {
  describe('recordOutput and getLastOutputTimestamp', () => {
    it('records and retrieves output timestamp', () => {
      const store = new AgentOutputStore();
      const before = Date.now();

      store.recordOutput('chatroom1', 'builder');

      const after = Date.now();
      const timestamp = store.getLastOutputTimestamp('chatroom1', 'builder');

      expect(timestamp).toBeDefined();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('returns undefined for unknown agent', () => {
      const store = new AgentOutputStore();

      const timestamp = store.getLastOutputTimestamp('chatroom1', 'builder');

      expect(timestamp).toBeUndefined();
    });

    it('updates timestamp on subsequent output', async () => {
      const store = new AgentOutputStore();

      store.recordOutput('chatroom1', 'builder');
      const first = store.getLastOutputTimestamp('chatroom1', 'builder')!;

      await new Promise((resolve) => setTimeout(resolve, 5));

      store.recordOutput('chatroom1', 'builder');
      const second = store.getLastOutputTimestamp('chatroom1', 'builder')!;

      expect(second).toBeGreaterThan(first);
    });

    it('tracks multiple agents independently', () => {
      const store = new AgentOutputStore();

      store.recordOutput('chatroom1', 'builder');
      store.recordOutput('chatroom1', 'reviewer');
      store.recordOutput('chatroom2', 'builder');

      expect(store.getLastOutputTimestamp('chatroom1', 'builder')).toBeDefined();
      expect(store.getLastOutputTimestamp('chatroom1', 'reviewer')).toBeDefined();
      expect(store.getLastOutputTimestamp('chatroom2', 'builder')).toBeDefined();
      expect(store.getLastOutputTimestamp('chatroom2', 'reviewer')).toBeUndefined();
    });
  });

  describe('isIdle', () => {
    it('returns false for agent with recent output', () => {
      const store = new AgentOutputStore();

      store.recordOutput('chatroom1', 'builder');

      const isIdle = store.isIdle('chatroom1', 'builder', 60_000); // 1 min threshold

      expect(isIdle).toBe(false);
    });

    it('returns false for unknown agent (never produced output)', () => {
      const store = new AgentOutputStore();

      const isIdle = store.isIdle('chatroom1', 'builder', 60_000);

      // Unknown agent is not considered idle — it just started
      expect(isIdle).toBe(false);
    });

    it('returns true for agent idle beyond threshold', async () => {
      const store = new AgentOutputStore();

      store.recordOutput('chatroom1', 'builder');

      // Wait a bit (use shorter threshold for test)
      const isIdleImmediately = store.isIdle('chatroom1', 'builder', 10_000);
      expect(isIdleImmediately).toBe(false);

      // Wait 20ms and check with 10ms threshold
      await new Promise((resolve) => setTimeout(resolve, 20));
      const isIdleAfterWait = store.isIdle('chatroom1', 'builder', 10);
      expect(isIdleAfterWait).toBe(true);
    });

    it('uses exact threshold boundary correctly', async () => {
      const store = new AgentOutputStore();

      store.recordOutput('chatroom1', 'builder');

      // At exactly threshold, should still be NOT idle
      const isIdleAtBoundary = store.isIdle('chatroom1', 'builder', 10);
      expect(isIdleAtBoundary).toBe(false);

      // Just over threshold, should be idle
      await new Promise((resolve) => setTimeout(resolve, 15));
      const isIdleOverBoundary = store.isIdle('chatroom1', 'builder', 10);
      expect(isIdleOverBoundary).toBe(true);
    });
  });

  describe('getTrackedAgents', () => {
    it('returns empty array when no agents tracked', () => {
      const store = new AgentOutputStore();

      const agents = store.getTrackedAgents();

      expect(agents).toEqual([]);
    });

    it('returns all tracked agents with their timestamps', () => {
      const store = new AgentOutputStore();

      store.recordOutput('chatroom1', 'builder');
      store.recordOutput('chatroom1', 'reviewer');

      const agents = store.getTrackedAgents();

      expect(agents).toHaveLength(2);
      expect(agents).toContainEqual(
        expect.objectContaining({
          chatroomId: 'chatroom1',
          role: 'builder',
          lastOutputAt: expect.any(Number),
        })
      );
      expect(agents).toContainEqual(
        expect.objectContaining({
          chatroomId: 'chatroom1',
          role: 'reviewer',
          lastOutputAt: expect.any(Number),
        })
      );
    });
  });

  describe('remove', () => {
    it('removes agent from tracking', () => {
      const store = new AgentOutputStore();

      store.recordOutput('chatroom1', 'builder');
      expect(store.getLastOutputTimestamp('chatroom1', 'builder')).toBeDefined();

      store.remove('chatroom1', 'builder');

      expect(store.getLastOutputTimestamp('chatroom1', 'builder')).toBeUndefined();
      expect(store.isIdle('chatroom1', 'builder', 60_000)).toBe(false);
    });

    it('handles removing non-existent agent gracefully', () => {
      const store = new AgentOutputStore();

      // Should not throw
      expect(() => store.remove('chatroom1', 'builder')).not.toThrow();
    });

    it('removes only specified agent', () => {
      const store = new AgentOutputStore();

      store.recordOutput('chatroom1', 'builder');
      store.recordOutput('chatroom1', 'reviewer');

      store.remove('chatroom1', 'builder');

      expect(store.getLastOutputTimestamp('chatroom1', 'builder')).toBeUndefined();
      expect(store.getLastOutputTimestamp('chatroom1', 'reviewer')).toBeDefined();
    });
  });
});
