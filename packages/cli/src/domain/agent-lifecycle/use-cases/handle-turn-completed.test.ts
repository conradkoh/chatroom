import { describe, expect, test, vi } from 'vitest';

import { handleTurnCompleted, type HandleTurnCompletedDeps } from './handle-turn-completed.js';
import type { TurnEndSlot } from '../entities/turn-end.js';
import type { ResumeStormTracker } from '../ports/resume-storm-tracker.js';

function createTracker(threshold = 5, windowMs = 30_000): ResumeStormTracker {
  const history = new Map<string, number[]>();
  return {
    record(chatroomId, role, now) {
      const key = `${chatroomId}:${role.toLowerCase()}`;
      const recent = (history.get(key) ?? []).filter((ts) => ts >= now - windowMs);
      recent.push(now);
      history.set(key, recent);
      return {
        isStorm: recent.length >= threshold,
        endCount: recent.length,
        windowMs,
        threshold,
      };
    },
    reset(chatroomId, role) {
      history.delete(`${chatroomId}:${role.toLowerCase()}`);
    },
  };
}

function createDeps(overrides?: Partial<HandleTurnCompletedDeps>): {
  deps: HandleTurnCompletedDeps;
  backend: {
    emitResumeStormAborted: ReturnType<typeof vi.fn>;
    emitAgentStartFailed: ReturnType<typeof vi.fn>;
  };
} {
  const backend = {
    emitResumeStormAborted: vi.fn().mockResolvedValue(undefined),
    emitAgentStartFailed: vi.fn().mockResolvedValue(undefined),
  };
  const deps: HandleTurnCompletedDeps = {
    resumeStormTracker: createTracker(),
    backend,
    now: () => 1_000_000,
    killProcess: vi.fn(),
    stopAgent: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
  return { deps, backend };
}

const baseInput = {
  chatroomId: 'room-1',
  role: 'builder',
  pid: 42,
};

describe('handleTurnCompleted', () => {
  test('kills the process after a normal turn end', async () => {
    const { deps } = createDeps();

    const result = await handleTurnCompleted(deps, baseInput, undefined);

    expect(result).toEqual({ outcome: 'killed' });
    expect(deps.killProcess).toHaveBeenCalledWith(42);
  });

  test('kills the process after a normal turn end even when logs mention rate limits', async () => {
    const { deps } = createDeps();
    const slot: TurnEndSlot = {
      state: 'running',
      pid: 42,
      recentLogLines: [
        '[ts] role:builder error] message="stream error" error.error="AI_APICallError: Rate limit exceeded. Please try again later."',
      ],
    };

    const result = await handleTurnCompleted(deps, baseInput, slot);

    expect(result).toEqual({ outcome: 'killed' });
    expect(deps.killProcess).toHaveBeenCalledWith(42);
  });

  test('kills the process after turn end when logs show model load failure', async () => {
    const { deps } = createDeps();
    const slot: TurnEndSlot = {
      state: 'running',
      pid: 42,
      recentLogLines: [
        '[ts] role:builder error] Failed to load model "qwen/qwen3.6-35b-a3b". Model loading was stopped due to insufficient system resources.',
      ],
    };

    const result = await handleTurnCompleted(deps, baseInput, slot);

    expect(result).toEqual({ outcome: 'killed' });
    expect(deps.killProcess).toHaveBeenCalledWith(42);
  });

  test('stops agent when emitResumeStormAborted fails', async () => {
    const tracker = createTracker(3);
    let tick = 1_000_000;
    const { deps, backend } = createDeps({
      resumeStormTracker: tracker,
      now: () => tick,
    });
    backend.emitResumeStormAborted.mockRejectedValue(new Error('network down'));
    const slot: TurnEndSlot = { state: 'running', pid: 42 };

    await handleTurnCompleted(deps, baseInput, slot);
    tick += 100;
    await handleTurnCompleted(deps, baseInput, slot);
    tick += 100;
    const result = await handleTurnCompleted(deps, baseInput, slot);

    expect(result).toEqual({ outcome: 'storm_aborted' });
    expect(deps.stopAgent).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      reason: 'platform.resume_storm',
    });
  });

  test('aborts storm, classifies reason, emits event, and stops agent', async () => {
    const tracker = createTracker(3);
    let tick = 1_000_000;
    const { deps, backend } = createDeps({
      resumeStormTracker: tracker,
      now: () => tick,
    });
    const slot: TurnEndSlot = {
      state: 'running',
      pid: 42,
      recentLogLines: ['agent_end'],
    };

    await handleTurnCompleted(deps, baseInput, slot);
    tick += 100;
    await handleTurnCompleted(deps, baseInput, slot);
    tick += 100;
    slot.recentLogLines?.push('HTTP 429 rate limit exceeded');
    const result = await handleTurnCompleted(deps, baseInput, slot);

    expect(result).toEqual({ outcome: 'storm_aborted' });
    expect(backend.emitResumeStormAborted).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      reason: 'rate_limit',
      endCount: 3,
      windowMs: 30_000,
    });
    expect(deps.stopAgent).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      reason: 'platform.resume_storm',
    });
  });
});
