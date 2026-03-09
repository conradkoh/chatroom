/**
 * Intentional Stop Tracking — Unit Tests
 *
 * Verifies that the intentional stop mechanism correctly distinguishes
 * between intentional agent stops and unexpected crashes:
 *
 * 1. markIntentionalStop + consumeIntentionalStop flow (stop-agent path)
 * 2. consumeIntentionalStop returns null for unexpected exits (crash path)
 * 3. clearIntentionalStop cleans up on failure
 * 4. Case-insensitive role matching
 * 5. Multiple agents tracked independently
 * 6. Daemon shutdown: multiple agents marked at once
 * 7. daemon.respawn reason is stored and returned correctly
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  agentKey,
  markIntentionalStop,
  consumeIntentionalStop,
  clearIntentionalStop,
  isMarkedForIntentionalStop,
  resetIntentionalStops,
} from './intentional-stops.js';

// ---------------------------------------------------------------------------
// Reset state between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  resetIntentionalStops();
});

// ---------------------------------------------------------------------------
// agentKey
// ---------------------------------------------------------------------------

describe('agentKey', () => {
  it('builds key from chatroomId and lowercased role', () => {
    expect(agentKey('chatroom123', 'Builder')).toBe('chatroom123:builder');
  });

  it('handles already-lowercase roles', () => {
    expect(agentKey('room-abc', 'planner')).toBe('room-abc:planner');
  });
});

// ---------------------------------------------------------------------------
// Intentional stop flow (stop-agent → onExit)
// ---------------------------------------------------------------------------

describe('intentional stop flow', () => {
  it('marks and consumes an intentional stop — returns user.stop reason', () => {
    markIntentionalStop('chatroom1', 'builder');

    // Should be marked
    expect(isMarkedForIntentionalStop('chatroom1', 'builder')).toBe(true);

    // Consuming should return 'user.stop' (and remove the marker)
    expect(consumeIntentionalStop('chatroom1', 'builder')).toBe('user.stop');

    // After consuming, the marker is gone
    expect(isMarkedForIntentionalStop('chatroom1', 'builder')).toBe(false);
  });

  it('returns null when consuming a non-existent marker (crash path)', () => {
    // No markIntentionalStop call — simulates an unexpected crash
    expect(consumeIntentionalStop('chatroom1', 'builder')).toBeNull();
  });

  it('consuming is idempotent — second consume returns null', () => {
    markIntentionalStop('chatroom1', 'reviewer');

    expect(consumeIntentionalStop('chatroom1', 'reviewer')).toBe('user.stop');
    expect(consumeIntentionalStop('chatroom1', 'reviewer')).toBeNull();
  });

  it('marks and consumes a daemon.respawn — returns daemon.respawn reason', () => {
    markIntentionalStop('chatroom1', 'builder', 'daemon.respawn');

    expect(isMarkedForIntentionalStop('chatroom1', 'builder')).toBe(true);
    expect(consumeIntentionalStop('chatroom1', 'builder')).toBe('daemon.respawn');
    expect(isMarkedForIntentionalStop('chatroom1', 'builder')).toBe(false);
  });

  it('default reason is user.stop when not specified', () => {
    markIntentionalStop('chatroom1', 'planner');
    expect(consumeIntentionalStop('chatroom1', 'planner')).toBe('user.stop');
  });

  it('daemon.respawn and user.stop can coexist for different roles', () => {
    markIntentionalStop('chatroom1', 'builder', 'daemon.respawn');
    markIntentionalStop('chatroom1', 'reviewer', 'user.stop');

    expect(consumeIntentionalStop('chatroom1', 'builder')).toBe('daemon.respawn');
    expect(consumeIntentionalStop('chatroom1', 'reviewer')).toBe('user.stop');
  });
});

// ---------------------------------------------------------------------------
// clearIntentionalStop (failure cleanup)
// ---------------------------------------------------------------------------

describe('clearIntentionalStop', () => {
  it('removes the marker without consuming', () => {
    markIntentionalStop('chatroom1', 'builder');

    clearIntentionalStop('chatroom1', 'builder');

    // Marker is gone
    expect(isMarkedForIntentionalStop('chatroom1', 'builder')).toBe(false);
    // Consume also returns null
    expect(consumeIntentionalStop('chatroom1', 'builder')).toBeNull();
  });

  it('is safe to call when no marker exists', () => {
    // Should not throw
    clearIntentionalStop('chatroom1', 'builder');
  });
});

// ---------------------------------------------------------------------------
// Case-insensitive role matching
// ---------------------------------------------------------------------------

describe('case-insensitive role matching', () => {
  it('matches regardless of role case in mark vs consume', () => {
    markIntentionalStop('chatroom1', 'Builder');
    expect(consumeIntentionalStop('chatroom1', 'builder')).toBe('user.stop');
  });

  it('matches regardless of role case in mark vs isMarked', () => {
    markIntentionalStop('chatroom1', 'REVIEWER');
    expect(isMarkedForIntentionalStop('chatroom1', 'reviewer')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multiple agents tracked independently
// ---------------------------------------------------------------------------

describe('multiple agents', () => {
  it('tracks different chatroom+role combinations independently', () => {
    markIntentionalStop('chatroom1', 'builder');
    markIntentionalStop('chatroom2', 'reviewer');

    // Each has its own marker
    expect(isMarkedForIntentionalStop('chatroom1', 'builder')).toBe(true);
    expect(isMarkedForIntentionalStop('chatroom2', 'reviewer')).toBe(true);

    // Consuming one doesn't affect the other
    expect(consumeIntentionalStop('chatroom1', 'builder')).toBe('user.stop');
    expect(isMarkedForIntentionalStop('chatroom2', 'reviewer')).toBe(true);
  });

  it('same chatroom different roles are independent', () => {
    markIntentionalStop('chatroom1', 'builder');
    markIntentionalStop('chatroom1', 'reviewer');

    expect(consumeIntentionalStop('chatroom1', 'builder')).toBe('user.stop');
    expect(consumeIntentionalStop('chatroom1', 'reviewer')).toBe('user.stop');
  });

  it('same role different chatrooms are independent', () => {
    markIntentionalStop('chatroom1', 'builder');
    markIntentionalStop('chatroom2', 'builder');

    expect(consumeIntentionalStop('chatroom1', 'builder')).toBe('user.stop');
    expect(consumeIntentionalStop('chatroom2', 'builder')).toBe('user.stop');
  });
});

// ---------------------------------------------------------------------------
// Daemon shutdown scenario
// ---------------------------------------------------------------------------

describe('daemon shutdown scenario', () => {
  it('marks multiple agents as intentional before shutdown', () => {
    // Simulate daemon shutdown: mark all tracked agents
    const agents = [
      { chatroomId: 'chatroom1', role: 'builder' },
      { chatroomId: 'chatroom1', role: 'reviewer' },
      { chatroomId: 'chatroom2', role: 'planner' },
    ];

    for (const agent of agents) {
      markIntentionalStop(agent.chatroomId, agent.role);
    }

    // All should be marked
    for (const agent of agents) {
      expect(isMarkedForIntentionalStop(agent.chatroomId, agent.role)).toBe(true);
    }

    // Consuming each should return the reason once
    for (const agent of agents) {
      expect(consumeIntentionalStop(agent.chatroomId, agent.role)).toBe('user.stop');
    }

    // All consumed
    for (const agent of agents) {
      expect(isMarkedForIntentionalStop(agent.chatroomId, agent.role)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// resetIntentionalStops
// ---------------------------------------------------------------------------

describe('resetIntentionalStops', () => {
  it('clears all markers', () => {
    markIntentionalStop('chatroom1', 'builder');
    markIntentionalStop('chatroom2', 'reviewer');

    resetIntentionalStops();

    expect(isMarkedForIntentionalStop('chatroom1', 'builder')).toBe(false);
    expect(isMarkedForIntentionalStop('chatroom2', 'reviewer')).toBe(false);
  });
});
