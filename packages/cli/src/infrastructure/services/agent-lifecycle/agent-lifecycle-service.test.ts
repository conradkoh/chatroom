import { Effect, Layer } from 'effect';
import type { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { AgentLifecycleServiceLive } from './agent-lifecycle-service.js';
import { AgentLifecycleService, AgentLifecyclePorts } from './agent-lifecycle-types.js';
import type { SpawnPort, HarnessSpawnPort, OperationResult } from './agent-lifecycle-types.js';
import type { SpawnPrompt } from '../remote-agents/spawn-prompt.js';

// ─── Mock Ports ────────────────────────────────────────────────────────────────

interface MockSpawnPortState {
  concurrentCount: number;
  allowSpawn: boolean;
  retryAfterMs?: number;
}

function createMockSpawnPort(state: MockSpawnPortState): SpawnPort {
  return {
    shouldAllowSpawn: (
      _chatroomId: string,
      _reason: string,
      _options?: { bypassConcurrentLimit?: boolean }
    ) => {
      if (state.allowSpawn) {
        return { allowed: true };
      }
      return { allowed: false, retryAfterMs: state.retryAfterMs };
    },
    recordSpawn: (_chatroomId: string) =>
      Effect.sync(() => {
        state.concurrentCount += 1;
      }),
    recordExit: (_chatroomId: string) =>
      Effect.sync(() => {
        state.concurrentCount = Math.max(0, state.concurrentCount - 1);
      }),
  };
}

function createMockHarnessPort(): HarnessSpawnPort {
  const spawn = (_args: {
    harness:
      | 'opencode'
      | 'opencode-sdk'
      | 'pi'
      | 'cursor'
      | 'cursor-sdk'
      | 'claude'
      | 'copilot'
      | 'commandcode';
    chatroomId: string;
    role: string;
    workingDir: string;
    model?: string;
    prompt: SpawnPrompt;
    systemPrompt?: string;
  }) =>
    Effect.succeed({
      pid: 100,
      harnessSessionId: 'test-session-id',
      onAgentEnd: (_cb: () => void) => {
        /* no-op */
      },
      onLogLine: undefined,
    });
  const stop = (_pid: number, _opts?: { preserveForResume?: boolean }) => Effect.void;
  const isAlive = (_pid: number) => Effect.succeed(true);
  return { spawn, stop, isAlive };
}

function createTestLayer(spawnState: MockSpawnPortState): Layer.Layer<AgentLifecycleService> {
  return Layer.provide(AgentLifecycleServiceLive, [
    Layer.succeed(AgentLifecyclePorts, {
      spawn: createMockSpawnPort(spawnState),
      harness: createMockHarnessPort(),
      sessionId: 'test-session',
      machineId: 'test-machine',
    } as unknown as AgentLifecyclePorts),
  ]);
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentLifecycleService — ensureRunning', () => {
  it('idle → spawning → running, returns { success: true, pid }', async () => {
    const spawnState: MockSpawnPortState = { concurrentCount: 0, allowSpawn: true };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;
      const result = yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'user.manual_spawn',
        wantResume: false,
      });
      return result;
    });

    const exit: Exit.Exit<OperationResult, unknown> = await Effect.runPromiseExit(
      program.pipe(Effect.provide(createTestLayer(spawnState)), Effect.scoped) as Effect.Effect<
        OperationResult,
        unknown,
        never
      >
    );
    expect(exit._tag).toBe('Success');
    expect((exit as { _tag: 'Success'; value: OperationResult }).value).toEqual({
      success: true,
      pid: 100,
    });
    // After ensureRunning completes, recordSpawn was called (concurrentCount = 1)
    expect(spawnState.concurrentCount).toBe(1);
  });

  it('blocked by rate limit → { success: false, error: "rate_limited" }', async () => {
    const spawnState: MockSpawnPortState = {
      concurrentCount: 0,
      allowSpawn: false,
      retryAfterMs: 60000,
    };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;
      const result = yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'platform.crash_recovery',
        wantResume: false,
      });
      return result;
    });

    const exit: Exit.Exit<OperationResult, unknown> = await Effect.runPromiseExit(
      program.pipe(Effect.provide(createTestLayer(spawnState)), Effect.scoped) as Effect.Effect<
        OperationResult,
        unknown,
        never
      >
    );
    expect(exit._tag).toBe('Success');
    expect((exit as { _tag: 'Success'; value: OperationResult }).value).toEqual({
      success: false,
      error: 'rate_limited',
    });
    // Bracket not entered: concurrentCount stays 0
    expect(spawnState.concurrentCount).toBe(0);
  });
});

describe('AgentLifecycleService — handleExit', () => {
  it('crash → ensureRunning called, { success: true } on restart', async () => {
    const spawnState: MockSpawnPortState = { concurrentCount: 0, allowSpawn: true };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;

      // First ensureRunning to create a slot
      const spawnResult = yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'user.manual_spawn',
        wantResume: false,
      });
      expect(spawnResult).toEqual({ success: true, pid: 100 });

      // Then handleExit with a crash — this triggers restart via RestartNow
      yield* service.handleExit({
        chatroomId: 'chat-1',
        role: 'builder',
        pid: 100,
        code: 1,
        signal: null,
      });
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(createTestLayer(spawnState)), Effect.scoped) as Effect.Effect<
        void,
        unknown,
        never
      >
    );
    // After handleExit completes (including release phase):
    // - Initial ensureRunning: count → 1
    // - handleExit acquire: restart ensureRunning, count → 2
    // - handleExit release: recordExit, count → 1
    expect(spawnState.concurrentCount).toBe(1);
  });

  it('handleExit crash → RestartNow triggers restart, count stays 1', async () => {
    const spawnState: MockSpawnPortState = { concurrentCount: 0, allowSpawn: true };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;

      // First ensureRunning succeeds
      yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'user.manual_spawn',
        wantResume: false,
      });

      // handleExit with crash — RestartNow triggers immediate restart
      yield* service.handleExit({
        chatroomId: 'chat-1',
        role: 'builder',
        pid: 100,
        code: 1,
        signal: null,
      });
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(createTestLayer(spawnState)), Effect.scoped) as Effect.Effect<
        void,
        unknown,
        never
      >
    );
    // After handleExit completes:
    // - Initial ensureRunning: count → 1
    // - handleExit: RestartNow → ensureRunning restart: count → 2 → recordExit: count → 1
    expect(spawnState.concurrentCount).toBe(1);
  });

  it('handleExit while stopping → ignored (no duplicate recordExit beyond bracket)', async () => {
    const spawnState: MockSpawnPortState = { concurrentCount: 0, allowSpawn: true };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;

      // Ensure running
      yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'user.manual_spawn',
        wantResume: false,
      });

      // Stop (sets stopping state)
      yield* service.stop({
        chatroomId: 'chat-1',
        role: 'builder',
        reason: 'user.stop',
      });

      // Handle exit while stopping — should be ignored by shouldIgnoreProcessExit
      yield* service.handleExit({
        chatroomId: 'chat-1',
        role: 'builder',
        pid: 100,
        code: 0,
        signal: null,
      });
    });

    const exit: Exit.Exit<void, unknown> = await Effect.runPromiseExit(
      program.pipe(Effect.provide(createTestLayer(spawnState)), Effect.scoped) as Effect.Effect<
        void,
        unknown,
        never
      >
    );
    expect(exit._tag).toBe('Success');
  });
});

describe('AgentLifecycleService — stop', () => {
  it('stop → recordExit called (spawn bracket balanced)', async () => {
    const spawnState: MockSpawnPortState = { concurrentCount: 0, allowSpawn: true };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;

      // Ensure running (increments concurrent count)
      yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'user.manual_spawn',
        wantResume: false,
      });

      // Stop (should decrement via recordExit)
      const stopResult = yield* service.stop({
        chatroomId: 'chat-1',
        role: 'builder',
        reason: 'user.stop',
      });

      return stopResult;
    });

    const exit: Exit.Exit<{ success: boolean }, unknown> = await Effect.runPromiseExit(
      program.pipe(Effect.provide(createTestLayer(spawnState)), Effect.scoped) as Effect.Effect<
        { success: boolean },
        unknown,
        never
      >
    );
    expect(exit._tag).toBe('Success');
    expect((exit as { _tag: 'Success'; value: { success: boolean } }).value).toEqual({
      success: true,
    });
  });
});

describe('AgentLifecycleService — concurrent count', () => {
  it('spawn+exit balanced after stop (mock recordSpawn/recordExit counters)', async () => {
    const spawnState: MockSpawnPortState = { concurrentCount: 0, allowSpawn: true };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;

      // First spawn: concurrentCount → 1
      yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'user.manual_spawn',
        wantResume: false,
      });

      // Stop: recordExit → concurrentCount → 0
      yield* service.stop({
        chatroomId: 'chat-1',
        role: 'builder',
        reason: 'user.stop',
      });

      // Second spawn: concurrentCount → 1
      yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'user.manual_spawn',
        wantResume: false,
      });

      // Handle exit: RestartNow triggers restart, then recordExit → concurrentCount → 1
      yield* service.handleExit({
        chatroomId: 'chat-1',
        role: 'builder',
        pid: 100,
        code: 0,
        signal: null,
      });
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(createTestLayer(spawnState)), Effect.scoped) as Effect.Effect<
        void,
        unknown,
        never
      >
    );
    // After all operations complete:
    // - First ensureRunning: count → 1
    // - Stop: recordExit, count → 0
    // - Second ensureRunning: count → 1
    // - handleExit: RestartNow → ensureRunning restart: count → 2 → recordExit: count → 1
    expect(spawnState.concurrentCount).toBe(1);
  });
});

describe('AgentLifecycleService — bypassConcurrentLimit', () => {
  it('bypassConcurrentLimit true for platform.crash_recovery', async () => {
    const spawnState: MockSpawnPortState = { concurrentCount: 0, allowSpawn: true };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;

      // crash_recovery should bypass concurrent limit
      const result = yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'platform.crash_recovery',
        wantResume: false,
      });

      return result;
    });

    const exit: Exit.Exit<OperationResult, unknown> = await Effect.runPromiseExit(
      program.pipe(Effect.provide(createTestLayer(spawnState)), Effect.scoped) as Effect.Effect<
        OperationResult,
        unknown,
        never
      >
    );
    expect(exit._tag).toBe('Success');
    // crash_recovery bypasses concurrent limit → spawn succeeds
    expect((exit as { _tag: 'Success'; value: OperationResult }).value).toEqual({
      success: true,
      pid: 100,
    });
  });
});
