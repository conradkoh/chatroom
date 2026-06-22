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
    emitSessionResumed: ReturnType<typeof vi.fn>;
    emitSessionResumeFailed: ReturnType<typeof vi.fn>;
    emitAgentStartFailed: ReturnType<typeof vi.fn>;
  };
} {
  const backend = {
    emitResumeStormAborted: vi.fn().mockResolvedValue(undefined),
    emitSessionResumed: vi.fn().mockResolvedValue(undefined),
    emitSessionResumeFailed: vi.fn().mockResolvedValue(undefined),
    emitAgentStartFailed: vi.fn().mockResolvedValue(undefined),
  };
  const deps: HandleTurnCompletedDeps = {
    resumeStormTracker: createTracker(),
    backend,
    now: () => 1_000_000,
    composeResumePrompt: () => 'resume-prompt',
    resumeTurn: vi.fn().mockResolvedValue(undefined),
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
  supportsSessionResume: true,
  wantResume: true,
};

describe('handleTurnCompleted', () => {
  test('resumes when harness supports in-process resume', async () => {
    const { deps, backend } = createDeps();
    const slot: TurnEndSlot = { harnessSessionId: 'sess-1', state: 'running', pid: 42 };

    const result = await handleTurnCompleted(deps, baseInput, slot);

    expect(result).toEqual({ outcome: 'resumed' });
    expect(deps.resumeTurn).toHaveBeenCalledWith(42, 'resume-prompt');
    expect(backend.emitSessionResumed).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      harnessSessionId: 'sess-1',
    });
    expect(deps.killProcess).not.toHaveBeenCalled();
  });

  test('kills when harness does not support resume', async () => {
    const { deps } = createDeps();

    const result = await handleTurnCompleted(
      deps,
      { ...baseInput, supportsSessionResume: false },
      undefined
    );

    expect(result).toEqual({ outcome: 'killed' });
    expect(deps.resumeTurn).not.toHaveBeenCalled();
    expect(deps.killProcess).toHaveBeenCalledWith(42);
  });

  test('kills instead of resuming when wantResume is false', async () => {
    const { deps } = createDeps();
    const slot: TurnEndSlot = { harnessSessionId: 'sess-1', state: 'running', pid: 42 };

    const result = await handleTurnCompleted(deps, { ...baseInput, wantResume: false }, slot);

    expect(result).toEqual({ outcome: 'killed' });
    expect(deps.resumeTurn).not.toHaveBeenCalled();
    expect(deps.killProcess).toHaveBeenCalledWith(42);
  });

  test('kills after resumeTurn failure', async () => {
    const { deps, backend } = createDeps({
      resumeTurn: vi.fn().mockRejectedValue(new Error('session not found')),
    });

    const result = await handleTurnCompleted(deps, baseInput, { resumeInFlight: false });

    expect(result).toEqual({ outcome: 'killed' });
    expect(backend.emitSessionResumeFailed).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      reason: 'session not found',
    });
    expect(deps.killProcess).toHaveBeenCalledWith(42);
  });

  test('skips duplicate resume when one is already in flight', async () => {
    const { deps } = createDeps();
    const slot: TurnEndSlot = { resumeInFlight: true };

    const result = await handleTurnCompleted(deps, baseInput, slot);

    expect(result).toEqual({ outcome: 'skipped_duplicate' });
    expect(deps.resumeTurn).not.toHaveBeenCalled();
    expect(deps.killProcess).not.toHaveBeenCalled();
  });

  test('duplicate agent_end during in-flight resume does not count toward storm', async () => {
    const tracker = createTracker(3);
    let tick = 1_000_000;
    const { deps } = createDeps({
      resumeStormTracker: tracker,
      now: () => tick,
    });
    const slot: TurnEndSlot = { state: 'running', pid: 42, resumeInFlight: false };

    await handleTurnCompleted(deps, baseInput, slot);
    tick += 100;
    await handleTurnCompleted(deps, baseInput, slot);
    tick += 100;

    slot.resumeInFlight = true;
    for (let i = 0; i < 10; i++) {
      const duplicate = await handleTurnCompleted(deps, baseInput, slot);
      expect(duplicate).toEqual({ outcome: 'skipped_duplicate' });
      tick += 10;
    }

    slot.resumeInFlight = false;
    const result = await handleTurnCompleted(deps, baseInput, slot);

    expect(result).toEqual({ outcome: 'storm_aborted' });
    expect(deps.resumeTurn).toHaveBeenCalledTimes(2);
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

  test('kills immediately on terminal provider rate limit without resuming', async () => {
    const { deps, backend } = createDeps();
    const slot: TurnEndSlot = {
      state: 'running',
      pid: 42,
      recentLogLines: [
        'message="stream error" error.error="AI_APICallError: Rate limit exceeded. Please try again later."',
      ],
    };

    const result = await handleTurnCompleted(deps, baseInput, slot);

    expect(result).toEqual({ outcome: 'killed_terminal_provider_error' });
    expect(slot.terminalProviderFailureHandled).toBe(true);
    expect(deps.resumeTurn).not.toHaveBeenCalled();
    expect(deps.killProcess).toHaveBeenCalledWith(42);
    expect(backend.emitAgentStartFailed).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      error: expect.stringContaining('non-retryable'),
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
    expect(deps.resumeTurn).toHaveBeenCalledTimes(2);
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
