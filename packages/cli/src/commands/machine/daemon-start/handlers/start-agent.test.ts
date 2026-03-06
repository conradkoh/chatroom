/**
 * start-agent handler Unit Tests
 *
 * Tests handleStartAgent using injected dependencies.
 * Covers: no agent context, working dir validation, init prompt fetch,
 * spawn via RemoteAgentService, successful spawn, PID persistence, spawn failure,
 * and kill-existing-before-spawn behaviour.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemoteAgentService } from '../../../../infrastructure/services/remote-agents/remote-agent-service.js';
import type { DaemonDeps } from '../deps.js';
import { DaemonEventBus } from '../../../../events/daemon/event-bus.js';
import type { DaemonContext, StartAgentCommand } from '../types.js';
import { handleStartAgent } from './start-agent.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://test:3210',
}));

// Module-level mock for onAgentShutdown so individual tests can spy on it.
const onAgentShutdownMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../events/lifecycle/on-agent-shutdown.js', () => ({
  onAgentShutdown: (...args: unknown[]) => onAgentShutdownMock(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCommand(overrides?: Partial<StartAgentCommand['payload']>): StartAgentCommand {
  return {
    type: 'start-agent',
    reason: 'test',
    payload: {
      chatroomId: 'test-chatroom-123' as StartAgentCommand['payload']['chatroomId'],
      role: 'builder',
      agentHarness: 'opencode',
      ...overrides,
    },
  };
}

function createMockContext(options?: {
  initPrompt?: {
    prompt: string;
    rolePrompt: string;
    initialMessage: string;
  } | null;
  spawnResult?: {
    pid: number;
    onExit: (
      cb: (info: {
        code: number | null;
        signal: string | null;
        context: { machineId: string; chatroomId: string; role: string };
      }) => void
    ) => void;
    onOutput: (cb: () => void) => void;
    onAgentEnd?: (cb: () => void) => void;
  };
  spawnError?: Error;
  lifecycleState?: { state: string } | null;
  lifecycleError?: boolean;
  agentConfigs?: { machineId: string; role: string; spawnedAgentPid?: number }[];
  /** Local daemon state entries (simulates persisted PIDs from a previous spawn) */
  localAgentEntries?: {
    chatroomId: string;
    role: string;
    entry: { pid: number; harness: 'opencode' };
  }[];
}): DaemonContext {
  const spawnMock = vi.fn().mockImplementation(async () => {
    if (options?.spawnError) throw options.spawnError;
    if (options?.spawnResult) return options.spawnResult;
    return {
      pid: 5678,
      onExit: vi.fn(),
      onOutput: vi.fn(),
    };
  });

  const initPromptValue =
    options?.initPrompt !== undefined
      ? options.initPrompt
      : {
          prompt: 'test prompt',
          rolePrompt: 'role prompt',
          initialMessage: 'initial msg',
        };

  const lifecycleValue = options?.lifecycleState !== undefined ? options.lifecycleState : null;
  const agentConfigsValue = options?.agentConfigs ?? [];

  // Distinguish queries by args shape:
  // - getAgentConfigs: has chatroomId, no convexUrl
  // - getInitPrompt:   has convexUrl
  // - legacy lifecycle queries: no chatroomId, no convexUrl (return null / lifecycleValue)
  const queryMock = vi.fn().mockImplementation((_fnRef: unknown, args: Record<string, unknown>) => {
    if (args?.convexUrl) {
      return Promise.resolve(initPromptValue);
    }
    if (args?.chatroomId) {
      // getAgentConfigs call
      if (options?.lifecycleError) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ configs: agentConfigsValue });
    }
    // legacy / unknown query
    return Promise.resolve(lifecycleValue);
  });

  const deps: DaemonDeps = {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
    },
    processes: {
      kill: vi.fn(),
    },
    fs: {
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    },
    stops: {
      mark: vi.fn(),
      consume: vi.fn().mockReturnValue(false),
      clear: vi.fn(),
    },
    machine: {
      clearAgentPid: vi.fn(),
      persistAgentPid: vi.fn(),
      listAgentEntries: vi.fn().mockReturnValue(options?.localAgentEntries ?? []),
      persistEventCursor: vi.fn(),
      loadEventCursor: vi.fn().mockReturnValue(null),
    },
    clock: {
      now: vi.fn().mockReturnValue(Date.now()),
      delay: vi.fn().mockResolvedValue(undefined),
    },
  };

  const remoteAgentService = {
    spawn: spawnMock,
    stop: vi.fn(),
    isAlive: vi.fn().mockReturnValue(true),
    getTrackedProcesses: vi.fn().mockReturnValue([]),
    untrack: vi.fn(),
  } as unknown as RemoteAgentService;

  const ctx: DaemonContext = {
    client: {},
    sessionId: 'test-session-id',
    machineId: 'test-machine-id',
    config: null,
    deps,
    events: new DaemonEventBus(),
    agentServices: new Map([['opencode', remoteAgentService]]),
  };

  // Attach for test convenience (not part of DaemonContext type)
  (ctx as unknown as { _remoteAgentService: RemoteAgentService })._remoteAgentService =
    remoteAgentService;

  return ctx;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  onAgentShutdownMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleStartAgent', () => {
  it('returns failed when no workingDir in payload', async () => {
    const ctx = createMockContext();
    const cmd = createCommand();

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('No workingDir provided');
  });

  it('returns failed when working directory does not exist', async () => {
    const ctx = createMockContext();
    (ctx.deps.fs.stat as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ENOENT: no such file')
    );
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('Working directory does not exist');
  });

  it('returns failed when working directory is not a directory', async () => {
    const ctx = createMockContext();
    (ctx.deps.fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({
      isDirectory: () => false,
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('not a directory');
  });

  it('returns failed when init prompt fetch returns null', async () => {
    const ctx = createMockContext({ initPrompt: null });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('Failed to fetch init prompt');
  });

  it('returns failed when spawn throws', async () => {
    const ctx = createMockContext({
      spawnError: new Error('No driver registered'),
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('No driver registered');
  });

  it('successfully spawns an agent and persists PID', async () => {
    const ctx = createMockContext();
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Agent spawned');
    expect(result.result).toContain('PID: 5678');

    // Verify PID was persisted
    expect(ctx.deps.machine.persistAgentPid).toHaveBeenCalledWith(
      'test-machine-id',
      'test-chatroom-123',
      'builder',
      5678,
      'opencode'
    );

    // Verify backend was updated (updateSpawnedAgent only — no lifecycle FSM)
    expect(ctx.deps.backend.mutation).toHaveBeenCalledTimes(1);
  });

  it('emits agent:started event after successful spawn', async () => {
    const ctx = createMockContext();
    const cmd = createCommand({ workingDir: '/tmp/test', model: 'gpt-4o' });

    const listener = vi.fn();
    ctx.events.on('agent:started', listener);

    await handleStartAgent(ctx, cmd);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: 'test-chatroom-123',
        role: 'builder',
        pid: 5678,
        harness: 'opencode',
        model: 'gpt-4o',
      })
    );
  });

  it('emits agent:exited event when process exits', async () => {
    let onExitCallback:
      | ((info: {
          code: number | null;
          signal: string | null;
          context: { machineId: string; chatroomId: string; role: string };
        }) => void)
      | null = null;
    const ctx = createMockContext({
      spawnResult: {
        pid: 5678,
        onExit: (cb) => {
          onExitCallback = cb;
        },
        onOutput: vi.fn(),
      },
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const listener = vi.fn();
    ctx.events.on('agent:exited', listener);

    await handleStartAgent(ctx, cmd);

    expect(onExitCallback).not.toBeNull();
    onExitCallback!({
      code: 1,
      signal: 'SIGTERM',
      context: {
        machineId: 'test-machine-id',
        chatroomId: 'test-chatroom-123',
        role: 'builder',
      },
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: 'test-chatroom-123',
        role: 'builder',
        pid: 5678,
        code: 1,
        signal: 'SIGTERM',
        intentional: false,
      })
    );
  });

  it('returns failed when spawn throws with message', async () => {
    const ctx = createMockContext({
      spawnError: new Error('Failed to spawn process'),
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('Failed to spawn process');
  });

  // ── Lifecycle / query mock passthrough tests ──────────────────────────────

  it('proceeds normally when lifecycle is start_requested', async () => {
    const ctx = createMockContext({
      lifecycleState: { state: 'start_requested' },
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Agent spawned');
  });

  it('proceeds normally when no lifecycle record exists', async () => {
    const ctx = createMockContext({
      lifecycleState: null,
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Agent spawned');
  });

  it('proceeds normally when lifecycle query fails (fail-open)', async () => {
    const ctx = createMockContext({
      lifecycleError: true,
    });
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(result.result).toContain('Agent spawned');
  });

  // ── Kill-existing-before-spawn tests ─────────────────────────────────────

  it('kills existing alive agent before spawning a new one', async () => {
    const ctx = createMockContext({
      agentConfigs: [{ machineId: 'test-machine-id', role: 'builder', spawnedAgentPid: 9999 }],
    });

    // Existing PID is alive
    const service = ctx.agentServices.get('opencode')!;
    (service.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const cmd = createCommand({ workingDir: '/tmp/test' });
    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(onAgentShutdownMock).toHaveBeenCalledWith(ctx, {
      chatroomId: 'test-chatroom-123',
      role: 'builder',
      pid: 9999,
    });
  });

  it('skips kill when existing PID is not alive', async () => {
    const ctx = createMockContext({
      agentConfigs: [{ machineId: 'test-machine-id', role: 'builder', spawnedAgentPid: 9999 }],
    });

    // PID is NOT alive
    const service = ctx.agentServices.get('opencode')!;
    (service.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const cmd = createCommand({ workingDir: '/tmp/test' });
    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(onAgentShutdownMock).not.toHaveBeenCalled();
  });

  it('kills both backend PID and diverged local PID when both are alive', async () => {
    // Regression test: the backend PID (1111) and local daemon state PID (2222)
    // diverged (e.g. updateSpawnedAgent mutation failed after the previous spawn).
    // Both must be killed before the new agent is spawned.
    const ctx = createMockContext({
      agentConfigs: [{ machineId: 'test-machine-id', role: 'builder', spawnedAgentPid: 1111 }],
      localAgentEntries: [
        {
          chatroomId: 'test-chatroom-123',
          role: 'builder',
          entry: { pid: 2222, harness: 'opencode' },
        },
      ],
    });

    // Both PIDs are alive
    const service = ctx.agentServices.get('opencode')!;
    (service.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const cmd = createCommand({ workingDir: '/tmp/test' });
    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    // Both PIDs must have been killed
    expect(onAgentShutdownMock).toHaveBeenCalledTimes(2);
    expect(onAgentShutdownMock).toHaveBeenCalledWith(ctx, {
      chatroomId: 'test-chatroom-123',
      role: 'builder',
      pid: 1111,
    });
    expect(onAgentShutdownMock).toHaveBeenCalledWith(ctx, {
      chatroomId: 'test-chatroom-123',
      role: 'builder',
      pid: 2222,
    });
  });

  it('kills only the unique PID when backend and local state agree on the same PID', async () => {
    // When both sources have the same PID, it should only be killed once (deduplication).
    const ctx = createMockContext({
      agentConfigs: [{ machineId: 'test-machine-id', role: 'builder', spawnedAgentPid: 5555 }],
      localAgentEntries: [
        {
          chatroomId: 'test-chatroom-123',
          role: 'builder',
          entry: { pid: 5555, harness: 'opencode' },
        },
      ],
    });

    const service = ctx.agentServices.get('opencode')!;
    (service.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const cmd = createCommand({ workingDir: '/tmp/test' });
    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    // Only called once despite both sources reporting the same PID
    expect(onAgentShutdownMock).toHaveBeenCalledTimes(1);
    expect(onAgentShutdownMock).toHaveBeenCalledWith(ctx, {
      chatroomId: 'test-chatroom-123',
      role: 'builder',
      pid: 5555,
    });
  });

  it('kills local PID even when backend has no recorded PID', async () => {
    // Backend has no PID (e.g. updateSpawnedAgent never completed),
    // but local state has the PID from a previous spawn.
    const ctx = createMockContext({
      agentConfigs: [{ machineId: 'test-machine-id', role: 'builder', spawnedAgentPid: undefined }],
      localAgentEntries: [
        {
          chatroomId: 'test-chatroom-123',
          role: 'builder',
          entry: { pid: 7777, harness: 'opencode' },
        },
      ],
    });

    const service = ctx.agentServices.get('opencode')!;
    (service.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const cmd = createCommand({ workingDir: '/tmp/test' });
    const result = await handleStartAgent(ctx, cmd);

    expect(result.failed).toBe(false);
    expect(onAgentShutdownMock).toHaveBeenCalledWith(ctx, {
      chatroomId: 'test-chatroom-123',
      role: 'builder',
      pid: 7777,
    });
  });

  it('natural exit (code 0) without prior stop command emits intentional=false', async () => {
    // DESIGN DECISION: A process that exits with code 0 (normal completion) is
    // treated identically to a crash if no explicit stop was requested.
    // See on-agent-exited.ts for the reliability rationale.
    let onExitCallback: ((info: {
      code: number | null;
      signal: string | null;
      context: { machineId: string; chatroomId: string; role: string };
    }) => void) | null = null;

    const ctx = createMockContext({
      spawnResult: {
        pid: 5678,
        onExit: (cb) => { onExitCallback = cb; },
        onOutput: vi.fn(),
      },
    });
    // stops.consume() already returns false by default (no prior stops.mark())
    const cmd = createCommand({ workingDir: '/tmp/test' });

    const listener = vi.fn();
    ctx.events.on('agent:exited', listener);

    await handleStartAgent(ctx, cmd);

    // Trigger natural exit (code 0)
    onExitCallback!({
      code: 0,
      signal: null,
      context: { machineId: 'test-machine-id', chatroomId: 'test-chatroom-123', role: 'builder' },
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 0,
        signal: null,
        intentional: false,  // ← the key assertion
        stopReason: 'process_exited_with_success',  // ← new assertion
      })
    );
  });

  it('emits stopReason=process_terminated_with_signal for SIGTERM exit', async () => {
    let onExitCallback: ((info: {
      code: number | null;
      signal: string | null;
      context: { machineId: string; chatroomId: string; role: string };
    }) => void) | null = null;

    const ctx = createMockContext({
      spawnResult: {
        pid: 5678,
        onExit: (cb) => { onExitCallback = cb; },
        onOutput: vi.fn(),
      },
    });

    const cmd = createCommand({ workingDir: '/tmp/test' });
    const listener = vi.fn();
    ctx.events.on('agent:exited', listener);

    await handleStartAgent(ctx, cmd);

    // Trigger SIGTERM exit
    onExitCallback!({
      code: null,
      signal: 'SIGTERM',
      context: { machineId: 'test-machine-id', chatroomId: 'test-chatroom-123', role: 'builder' },
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        code: null,
        signal: 'SIGTERM',
        intentional: false,
        stopReason: 'process_terminated_with_signal',
      })
    );
  });

  it('emits stopReason=process_terminated_with_signal for SIGKILL exit', async () => {
    let onExitCallback: ((info: {
      code: number | null;
      signal: string | null;
      context: { machineId: string; chatroomId: string; role: string };
    }) => void) | null = null;

    const ctx = createMockContext({
      spawnResult: {
        pid: 5678,
        onExit: (cb) => { onExitCallback = cb; },
        onOutput: vi.fn(),
      },
    });

    const cmd = createCommand({ workingDir: '/tmp/test' });
    const listener = vi.fn();
    ctx.events.on('agent:exited', listener);

    await handleStartAgent(ctx, cmd);

    // Trigger SIGKILL exit
    onExitCallback!({
      code: null,
      signal: 'SIGKILL',
      context: { machineId: 'test-machine-id', chatroomId: 'test-chatroom-123', role: 'builder' },
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        code: null,
        signal: 'SIGKILL',
        intentional: false,
        stopReason: 'process_terminated_with_signal',
      })
    );
  });

  it('emits stopReason=intentional_stop when process exits after explicit stop', async () => {
    let onExitCallback: ((info: {
      code: number | null;
      signal: string | null;
      context: { machineId: string; chatroomId: string; role: string };
    }) => void) | null = null;

    const ctx = createMockContext({
      spawnResult: {
        pid: 5678,
        onExit: (cb) => { onExitCallback = cb; },
        onOutput: vi.fn(),
      },
    });

    // Mock the stops.consume to return true (simulating intentional stop)
    (ctx.deps.stops.consume as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    const cmd = createCommand({ workingDir: '/tmp/test' });
    const listener = vi.fn();
    ctx.events.on('agent:exited', listener);

    await handleStartAgent(ctx, cmd);

    // Trigger exit (after intentional stop)
    onExitCallback!({
      code: 0,
      signal: null,
      context: { machineId: 'test-machine-id', chatroomId: 'test-chatroom-123', role: 'builder' },
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 0,
        signal: null,
        intentional: true,
        stopReason: 'intentional_stop',
      })
    );
  });

  it('kills process with SIGTERM (no intentional mark) when onAgentEnd fires', async () => {
    let agentEndCallback: (() => void) | null = null;

    const ctx = createMockContext({
      spawnResult: {
        pid: 5678,
        onExit: vi.fn(),
        onOutput: vi.fn(),
        onAgentEnd: (cb) => {
          agentEndCallback = cb;
        },
      },
    });

    const cmd = createCommand({ workingDir: '/tmp/test' });
    await handleStartAgent(ctx, cmd);

    expect(agentEndCallback).not.toBeNull();

    // Simulate agent_end firing
    agentEndCallback!();

    // Should kill the process group (negative pid)
    expect(ctx.deps.processes.kill).toHaveBeenCalledWith(-5678, 'SIGTERM');
    // Must NOT mark as intentional — we want the restart lifecycle to fire
    expect(ctx.deps.stops.mark).not.toHaveBeenCalled();
  });

  it('does not register onAgentEnd handler when spawnResult does not provide it', async () => {
    const ctx = createMockContext({
      spawnResult: {
        pid: 5678,
        onExit: vi.fn(),
        onOutput: vi.fn(),
        // onAgentEnd intentionally omitted
      },
    });

    const cmd = createCommand({ workingDir: '/tmp/test' });

    // Should not throw even though onAgentEnd is absent
    await expect(handleStartAgent(ctx, cmd)).resolves.not.toThrow();
    expect(ctx.deps.processes.kill).not.toHaveBeenCalled();
  });
});
