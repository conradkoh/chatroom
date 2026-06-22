import { Effect, Layer } from 'effect';
import type { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { AgentLifecycleServiceLive } from './agent-lifecycle-service.js';
import { AgentLifecycleService, AgentLifecyclePorts } from './agent-lifecycle-types.js';
import type { SpawnPort, HarnessSpawnPort, OperationResult } from './agent-lifecycle-types.js';
import type { SpawnPrompt } from '../remote-agents/spawn-prompt.js';

interface MockSpawnPortState {
  allowSpawn: boolean;
  retryAfterMs?: number;
}

function createMockSpawnPort(state: MockSpawnPortState): SpawnPort {
  return {
    shouldAllowSpawn: (_chatroomId: string, _reason: string) => {
      if (state.allowSpawn) {
        return { allowed: true };
      }
      return { allowed: false, retryAfterMs: state.retryAfterMs };
    },
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

describe('AgentLifecycleService — ensureRunning', () => {
  it('idle → spawning → running, returns { success: true, pid }', async () => {
    const spawnState: MockSpawnPortState = { allowSpawn: true };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;
      return yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'user.manual_spawn',
        wantResume: false,
      });
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
  });

  it('blocked by rate limit → { success: false, error: "rate_limited" }', async () => {
    const spawnState: MockSpawnPortState = {
      allowSpawn: false,
      retryAfterMs: 60000,
    };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;
      return yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'platform.crash_recovery',
        wantResume: false,
      });
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
  });
});

describe('AgentLifecycleService — handleExit', () => {
  it('crash → restart path completes without error', async () => {
    const spawnState: MockSpawnPortState = { allowSpawn: true };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;

      const spawnResult = yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'user.manual_spawn',
        wantResume: false,
      });
      expect(spawnResult).toEqual({ success: true, pid: 100 });

      yield* service.handleExit({
        chatroomId: 'chat-1',
        role: 'builder',
        pid: 100,
        code: 1,
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

  it('handleExit while stopping → ignored', async () => {
    const spawnState: MockSpawnPortState = { allowSpawn: true };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;

      yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'user.manual_spawn',
        wantResume: false,
      });

      yield* service.stop({
        chatroomId: 'chat-1',
        role: 'builder',
        reason: 'user.stop',
      });

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
  it('stop → transitions slot to idle', async () => {
    const spawnState: MockSpawnPortState = { allowSpawn: true };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;

      yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'user.manual_spawn',
        wantResume: false,
      });

      return yield* service.stop({
        chatroomId: 'chat-1',
        role: 'builder',
        reason: 'user.stop',
      });
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

describe('AgentLifecycleService — crash recovery spawn', () => {
  it('platform.crash_recovery spawn succeeds when rate limit allows', async () => {
    const spawnState: MockSpawnPortState = { allowSpawn: true };
    const program = Effect.gen(function* () {
      const service = yield* AgentLifecycleService;
      return yield* service.ensureRunning({
        chatroomId: 'chat-1',
        role: 'builder',
        agentHarness: 'opencode',
        workingDir: '/tmp/work',
        reason: 'platform.crash_recovery',
        wantResume: false,
      });
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
  });
});
