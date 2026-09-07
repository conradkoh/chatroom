import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

import {
  AgentProcessManager,
  type AgentProcessManagerDeps,
  type EnsureRunningOpts,
  STOPPING_TIMEOUT_MS,
} from './agent-process-manager.js';
import { TEST_MODEL_OPENCODE } from '../../../testing/test-models.js';

import { untrackChildPid } from '../../entry/handlers/orphan-tracker.js';
import { NATIVE_DIRECT_HARNESS_NAMES } from '../local/harness/bound-harness-registry.js';
import type {
  RemoteAgentService,
  SpawnResult,
} from '../local/harness/services/remote-agent-service.js';
import { DEFAULT_TRIGGER_PROMPT } from '../local/harness/services/spawn-prompt.js';

type NativeSdkHarness = (typeof NATIVE_DIRECT_HARNESS_NAMES)[number];

vi.mock('../../entry/handlers/orphan-tracker.js', () => ({
  trackChildPid: vi.fn(),
  untrackChildPid: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const CHATROOM_ID = 'test-chatroom';
const ROLE = 'builder';
const PID = 42;

function createLivenessAwareProcessKill() {
  const deadPids = new Set<number>();
  const kill = vi.fn((pid: number, signal?: number | string) => {
    if (signal === 0) {
      if (deadPids.has(pid)) throw new Error('ESRCH');
      return;
    }
    if (signal === 'SIGTERM' || signal === 'SIGKILL') deadPids.add(pid);
  });
  const markAlive = (pid: number) => deadPids.delete(pid);
  const markDead = (pid: number) => deadPids.add(pid);
  return { kill: Object.assign(kill, { markAlive, markDead }), markAlive, markDead };
}

function createMockService() {
  return {
    id: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    isInstalled: vi.fn().mockResolvedValue(true),
    getVersion: vi.fn().mockResolvedValue({ version: '1.0.0', major: 1 }),
    listModels: vi.fn().mockResolvedValue([]),
    spawn: vi.fn().mockResolvedValue({
      pid: PID,
      onExit: vi.fn(),
      onOutput: vi.fn(),
      onAgentEnd: vi.fn(),
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    isAlive: vi.fn().mockReturnValue(false),
    getTrackedProcesses: vi.fn().mockReturnValue([]),
    untrack: vi.fn(),
  };
}

function mockBackendMutation(
  defaultResult: Record<string, unknown> = {}
) {
  return vi.fn().mockImplementation((endpoint: unknown, args?: Record<string, unknown>) => {
    if (
      args &&
      'sessionId' in args &&
      'machineId' in args &&
      'chatroomId' in args &&
      'role' in args &&
      !('action' in args) &&
      !('pid' in args) &&
      !('fact' in args)
    ) {
      return Promise.resolve({
        allowed: true,
        lifecycleRevision: args.lifecycleRevision ?? 0,
      });
    }
    return Promise.resolve(defaultResult);
  });
}

function createDeps(overrides?: Partial<AgentProcessManagerDeps>): AgentProcessManagerDeps {
  const liveness = createLivenessAwareProcessKill();
  const mockService = createMockService();
  mockService.stop.mockImplementation(async (pid: number) => {
    liveness.markDead(pid);
  });
  mockService.spawn.mockImplementation(async () => {
    liveness.markAlive(PID);
    return { pid: PID, onExit: vi.fn(), onOutput: vi.fn(), onAgentEnd: vi.fn() };
  });
  return {
    logEvent: vi.fn().mockResolvedValue(undefined),
    agentServices: new Map([['opencode', mockService]]),
    backend: {
      query: vi.fn().mockResolvedValue({
        prompt: true,
        rolePrompt: 'You are a builder',
        initialMessage: 'Start working',
      }),
      mutation: mockBackendMutation(),
    },
    lifecycleOutbox: { enqueue: vi.fn().mockResolvedValue({ success: true }) },
    sessionId: 'test-session',
    machineId: 'test-machine',
    processes: { kill: liveness.kill },
    clock: {
      delay: vi.fn().mockResolvedValue(undefined),
      now: vi.fn().mockReturnValue(Date.now()),
    },
    fs: {
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    },
    persistence: {
      persistAgentPid: vi.fn(),
      clearAgentPid: vi.fn(),
      listAgentEntries: vi.fn().mockResolvedValue([]),
    },
    spawning: {
      shouldAllowSpawn: vi.fn().mockReturnValue({ allowed: true }),
    },
    convexUrl: 'http://test:3210',
    ...overrides,
  };
}

async function triggerAgentEnd(manager: AgentProcessManager, cb: () => void): Promise<void> {
  cb();
  await manager.whenTurnEndsIdle();
}

function createOpts(overrides?: Partial<EnsureRunningOpts>): EnsureRunningOpts {
  return {
    chatroomId: CHATROOM_ID,
    role: ROLE,
    agentHarness: 'opencode',
    model: 'gpt-4',
    workingDir: '/tmp/test',
    reason: 'user.start',
    wantResume: true,
    ...overrides,
  };
}

function getMutationCallsByArgs(
  deps: AgentProcessManagerDeps,
  match: (args: Record<string, unknown>) => boolean
): Record<string, unknown>[] {
  return (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls
    .map((call: unknown[]) => call[1] as Record<string, unknown>)
    .filter(match);
}

function getLogEventCallsByArgs(
  deps: AgentProcessManagerDeps,
  match: (args: Record<string, unknown>) => boolean
): Record<string, unknown>[] {
  return (deps.logEvent as ReturnType<typeof vi.fn>).mock.calls
    .map((call: unknown[]) => call[0] as Record<string, unknown>)
    .filter(match);
}

/** Shared native SDK harness setup — behavior under test is harness-agnostic in AgentProcessManager. */
function createNativeSdkService(harness: NativeSdkHarness) {
  const resumeTurn = vi.fn().mockResolvedValue(undefined);
  const onAgentEndRegistrar = vi.fn();
  const service = {
    ...createMockService(),
    id: harness,
    resumeTurn,
    spawn: vi.fn().mockResolvedValue({
      pid: PID,
      harnessSessionId: `sess-${harness}-1`,
      onExit: vi.fn(),
      onOutput: vi.fn(),
      onAgentEnd: onAgentEndRegistrar,
    }),
  };
  return { service, resumeTurn, onAgentEndRegistrar };
}


// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AgentProcessManager', () => {
  let deps: AgentProcessManagerDeps;
  let manager: AgentProcessManager;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
    manager = new AgentProcessManager(deps);
  });

  // ── ensureRunning ─────────────────────────────────────────────────────

  describe('ensureRunning', () => {
    test('idle → spawning → running: spawns process and transitions correctly', async () => {
      const result = await manager.ensureRunning(createOpts());

      expect(result).toEqual({ success: true, pid: PID });

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot).toBeDefined();
      expect(slot!.state).toBe('running');
      expect(slot!.pid).toBe(PID);
      expect(slot!.harness).toBe('opencode');
      expect(slot!.model).toBe('gpt-4');
      expect(slot!.workingDir).toBe('/tmp/test');

      // Verify backend interactions
      const service = deps.agentServices.get('opencode')!;
      expect(service.spawn).toHaveBeenCalledOnce();
      expect(deps.persistence.persistAgentPid).toHaveBeenCalledWith(
        'test-machine',
        CHATROOM_ID,
        ROLE,
        PID,
        'opencode'
      );
    });

    test.each(NATIVE_DIRECT_HARNESS_NAMES)(
      'ensureRunning %s emits native:waiting after spawn',
      async (harness) => {
        const { service } = createNativeSdkService(harness);
        deps.agentServices = new Map([[harness, service]]);
        manager = new AgentProcessManager(deps);

        await manager.ensureRunning(
          createOpts({ agentHarness: harness as EnsureRunningOpts['agentHarness'] })
        );

        expect(deps.lifecycleOutbox.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'activity',
            chatroomId: CHATROOM_ID,
            role: ROLE,
            action: 'native:waiting',
          })
        );
      }
    );

    test('codex-sdk turn-end emits provider unavailable without start failure', async () => {
      const { service, onAgentEndRegistrar } = createNativeSdkService(
        'codex-sdk' as NativeSdkHarness
      );
      deps.agentServices = new Map([['codex-sdk', service]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(
        createOpts({
          agentHarness: 'codex-sdk',
          model: 'gpt-5.6-luna[reasoning=low]',
        })
      );
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockClear();

      manager.getSlot(CHATROOM_ID, ROLE)!.recentLogLines = [
        '[codex-sdk:builder run-error] Selected model is at capacity',
      ];
      manager.getSlot(CHATROOM_ID, ROLE)!.lastOutputAt = deps.clock.now() - 31_000;
      const agentEndCb = onAgentEndRegistrar.mock.calls[0][0] as () => void;
      await triggerAgentEnd(manager, agentEndCb);

      const providerCalls = getMutationCallsByArgs(
        deps,
        (args) => args.reason === 'model_capacity'
      );
      expect(providerCalls).toHaveLength(1);
      expect(providerCalls[0]).toMatchObject({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        model: 'gpt-5.6-luna[reasoning=low]',
        message: '[codex-sdk:builder run-error] Selected model is at capacity',
      });
      expect(getMutationCallsByArgs(deps, (args) => typeof args.error === 'string')).toHaveLength(
        0
      );
    });

    test('codex-sdk turn-end skips provider unavailable when output is recent', async () => {
      const { service, onAgentEndRegistrar } = createNativeSdkService(
        'codex-sdk' as NativeSdkHarness
      );
      deps.agentServices = new Map([['codex-sdk', service]]);
      manager = new AgentProcessManager(deps);
      await manager.ensureRunning(
        createOpts({ agentHarness: 'codex-sdk', model: 'gpt-5.6-luna[reasoning=low]' })
      );
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockClear();
      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      slot.recentLogLines = ['[codex-sdk:builder run-error] Selected model is at capacity'];
      slot.lastOutputAt = deps.clock.now();
      const agentEndCb = onAgentEndRegistrar.mock.calls[0][0] as () => void;
      await triggerAgentEnd(manager, agentEndCb);
      expect(getMutationCallsByArgs(deps, (args) => args.reason === 'model_capacity')).toHaveLength(
        0
      );
    });

    test('codex-sdk turn-end ignores vitest tool-output false positives', async () => {
      const { service, onAgentEndRegistrar } = createNativeSdkService(
        'codex-sdk' as NativeSdkHarness
      );
      deps.agentServices = new Map([['codex-sdk', service]]);
      manager = new AgentProcessManager(deps);
      await manager.ensureRunning(
        createOpts({ agentHarness: 'codex-sdk', model: 'gpt-5.6-luna[reasoning=low]' })
      );
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockClear();
      manager.getSlot(CHATROOM_ID, ROLE)!.recentLogLines = [
        '[codex-sdk:builder@7z81x2 tool-output] chatroom-cli:test: rate limited: returns failure\n[codex-sdk:builder@c1 spawn-error] Error\n⚠️ [RateLimiter] Agent spawn rate-limited',
        '[codex-sdk:builder agent_end]',
      ];
      const agentEndCb = onAgentEndRegistrar.mock.calls[0][0] as () => void;
      await triggerAgentEnd(manager, agentEndCb);
      expect(
        getMutationCallsByArgs(
          deps,
          (args) => args.reason === 'rate_limit' || args.reason === 'model_capacity'
        )
      ).toHaveLength(0);
    });

    test('ignores stale agent_end callback after role slot is replaced by a newer process', async () => {
      const STALE_PID = 42;
      const CURRENT_PID = 43;
      const staleOnAgentEndRegistrar = vi.fn();
      const currentOnAgentEndRegistrar = vi.fn();
      let spawnCallCount = 0;
      const harness = 'cursor-sdk' as NativeSdkHarness;
      const liveness = createLivenessAwareProcessKill();
      const service = {
        ...createMockService(),
        id: harness,
        resumeTurn: vi.fn().mockResolvedValue(undefined),
        spawn: vi.fn().mockImplementation(async () => {
          spawnCallCount += 1;
          if (spawnCallCount === 1) {
            liveness.markAlive(STALE_PID);
            return {
              pid: STALE_PID,
              harnessSessionId: 'sess-stale',
              onExit: vi.fn(),
              onOutput: vi.fn(),
              onAgentEnd: staleOnAgentEndRegistrar,
            };
          }
          liveness.markAlive(CURRENT_PID);
          return {
            pid: CURRENT_PID,
            harnessSessionId: 'sess-current',
            onExit: vi.fn(),
            onOutput: vi.fn(),
            onAgentEnd: currentOnAgentEndRegistrar,
          };
        }),
      };
      deps = createDeps({
        agentServices: new Map([[harness, service]]),
        processes: { kill: liveness.kill },
      });
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(createOpts({ agentHarness: harness }));
      const staleAgentEndCb = staleOnAgentEndRegistrar.mock.calls[0][0] as () => void;
      expect(staleAgentEndCb).toBeTypeOf('function');

      await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });
      await manager.ensureRunning(createOpts({ agentHarness: harness, wantResume: false }));

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot?.pid).toBe(CURRENT_PID);
      expect(slot?.state).toBe('running');

      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockClear();
      await triggerAgentEnd(manager, staleAgentEndCb);

      expect(manager.getSlot(CHATROOM_ID, ROLE)?.pid).toBe(CURRENT_PID);
      expect(manager.getSlot(CHATROOM_ID, ROLE)?.state).toBe('running');

      const currentAgentEndCb = currentOnAgentEndRegistrar.mock.calls[0][0] as () => void;
      await triggerAgentEnd(manager, currentAgentEndCb);
    });

    test('onAgentEnd kills process for non-resumable harness', async () => {
      const onAgentEndRegistrar = vi.fn();
      const service = {
        ...createMockService(),
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: onAgentEndRegistrar,
        }),
      };
      deps.agentServices = new Map([['opencode', service]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(createOpts({ agentHarness: 'opencode' }));

      const agentEndCb = onAgentEndRegistrar.mock.calls[0][0] as () => void;
      await triggerAgentEnd(manager, agentEndCb);

      expect(deps.processes.kill).toHaveBeenCalledWith(-PID, 'SIGTERM');
      // CLI harnesses (opencode, cursor, etc.) do not support native integration —
      // turn-end kills the process instead of emitting native:waiting.
      const nativeWaitingEnqueues = vi
        .mocked(deps.lifecycleOutbox.enqueue)
        .mock.calls.filter(
          ([fact]) => fact.kind === 'activity' && fact.action === 'native:waiting'
        );
      expect(nativeWaitingEnqueues).toHaveLength(0);
    });

    test('substitutes DEFAULT_TRIGGER_PROMPT when backend returns empty initialMessage', async () => {
      // Use case-level regression guard: composeInitMessage in the backend currently
      // returns '' for every role. The manager must wrap that via createSpawnPrompt
      // before calling service.spawn so harnesses never receive an empty user message.
      // Without this, the opencode-sdk harness sends parts:[{text:''}] which
      // some providers (e.g. MiniMax) reject with `messages must not be empty`.
      (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        prompt: true,
        rolePrompt: 'You are a builder',
        initialMessage: '',
      });

      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      expect(service.spawn).toHaveBeenCalledOnce();
      const spawnArgs = (service.spawn as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(spawnArgs.prompt).toBe(DEFAULT_TRIGGER_PROMPT);
      expect(spawnArgs.systemPrompt).toBe('You are a builder');
    });


    test('opencode-sdk spawn passes harnessSessionId to lifecycle outbox', async () => {
      const opencodeSdkService = {
        ...createMockService(),
        id: 'opencode-sdk',
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'sess-opencode-start',
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        }),
      };
      deps.agentServices = new Map([['opencode-sdk', opencodeSdkService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(createOpts({ agentHarness: 'opencode-sdk', wantResume: false }));

      expect(deps.lifecycleOutbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'spawned',
          pid: PID,
          harnessSessionId: 'sess-opencode-start',
        })
      );
    });

    test('claude-sdk spawn stores provisional UUID harnessSessionId for native delivery', async () => {
      const provisionalId = 'b9a4f2e1-3c7d-4a5b-9e8f-1a2b3c4d5e6f';
      const claudeSdkService = {
        ...createMockService(),
        id: 'claude-sdk',
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: provisionalId,
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        }),
      };
      deps.agentServices = new Map([['claude-sdk', claudeSdkService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(createOpts({ agentHarness: 'claude-sdk', wantResume: false }));

      expect(manager.getSlot(CHATROOM_ID, ROLE)!.harnessSessionId).toBe(provisionalId);
      expect(deps.lifecycleOutbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'spawned',
          harnessSessionId: provisionalId,
        })
      );
    });


    test('second start while running replaces PID', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      const NEW_PID = 99;
      (service.spawn as ReturnType<typeof vi.fn>).mockResolvedValue({
        pid: NEW_PID,
        onExit: vi.fn(),
        onOutput: vi.fn(),
        onAgentEnd: vi.fn(),
      });
      (service.stop as ReturnType<typeof vi.fn>).mockClear();
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();
      (deps.logEvent as ReturnType<typeof vi.fn>).mockClear();

      const result = await manager.ensureRunning(createOpts());

      expect(result).toEqual({ success: true, pid: NEW_PID });
      expect(service.stop).toHaveBeenCalledWith(PID);
      expect(service.spawn).toHaveBeenCalledOnce();
      expect(manager.getSlot(CHATROOM_ID, ROLE)!.pid).toBe(NEW_PID);

      expect(deps.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: PID,
          stopReason: 'daemon.respawn',
        })
      );
    });

    test('persisted live PID without slot is killed before spawn', async () => {
      const ORPHAN_PID = 7777;
      (
        deps.processes.kill as typeof deps.processes.kill & { markAlive: (pid: number) => void }
      ).markAlive(ORPHAN_PID);
      (deps.persistence.listAgentEntries as ReturnType<typeof vi.fn>).mockResolvedValue([
        { chatroomId: CHATROOM_ID, role: ROLE, entry: { pid: ORPHAN_PID, harness: 'opencode' } },
      ]);

      const result = await manager.ensureRunning(createOpts());

      expect(result).toEqual({ success: true, pid: PID });
      const service = deps.agentServices.get('opencode')!;
      expect(service.stop).toHaveBeenCalledWith(ORPHAN_PID);
      expect(untrackChildPid).toHaveBeenCalledWith(ORPHAN_PID);
      expect(deps.persistence.clearAgentPid).toHaveBeenCalledWith(
        'test-machine',
        CHATROOM_ID,
        ROLE
      );
      expect(deps.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: ORPHAN_PID,
          stopReason: 'daemon.respawn',
        })
      );
    });

    test('running slot with dead PID: resets to idle and spawns', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();

      // First kill(pid, 0) in ensureRunning liveness check throws → dead
      (deps.processes.kill as ReturnType<typeof vi.fn>).mockImplementation(
        (_pid: number, signal?: number | string) => {
          if (signal === 0) {
            throw new Error('ESRCH');
          }
        }
      );

      const result = await manager.ensureRunning(createOpts());

      expect(result).toEqual({ success: true, pid: PID });
      expect(service.spawn).toHaveBeenCalledOnce();
    });

    test('concurrent calls: second call awaits the first, does not spawn twice', async () => {
      let resolveSpawn: (value: any) => void;
      const spawnPromise = new Promise((resolve) => {
        resolveSpawn = resolve;
      });

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        await spawnPromise;
        return {
          pid: PID,
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        };
      });

      // Fire both concurrently
      const p1 = manager.ensureRunning(createOpts());
      const p2 = manager.ensureRunning(createOpts());

      // Resolve the spawn
      resolveSpawn!(undefined);

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toEqual({ success: true, pid: PID });
      expect(r2).toEqual({ success: true, pid: PID });
      expect(service.spawn).toHaveBeenCalledTimes(1);
    });

    test('rate limited: returns failure, slot stays idle', async () => {
      (deps.spawning.shouldAllowSpawn as ReturnType<typeof vi.fn>).mockReturnValue({
        allowed: false,
      });

      const result = await manager.ensureRunning(createOpts());

      expect(result).toEqual({ success: false, error: 'rate_limited' });

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot!.state).toBe('idle');
    });

    test('spawn fails: returns failure, slot transitions back to idle', async () => {
      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('spawn error'));

      const result = await manager.ensureRunning(createOpts());

      expect(result).toEqual({ success: false, error: 'Failed to spawn agent: spawn error' });

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot!.state).toBe('idle');
    });

    test('invalid working dir: returns failure', async () => {
      (deps.fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({
        isDirectory: () => false,
      });

      const result = await manager.ensureRunning(createOpts());

      expect(result.success).toBe(false);
      expect(result.error).toContain('not a directory');
    });

    test('working dir does not exist: returns failure', async () => {
      (deps.fs.stat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

      const result = await manager.ensureRunning(createOpts());

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    test('unknown harness: returns failure', async () => {
      await manager.ensureRunning(
        createOpts({ agentHarness: 'cursor' }) // Use valid type but no service registered
      );
      // Remove the cursor service so it's "unknown"
      deps.agentServices.delete('cursor');

      const result2 = await manager.ensureRunning({
        ...createOpts(),
        agentHarness: 'cursor', // valid type, but no service for it
      });

      expect(result2.success).toBe(false);
      expect(result2.error).toContain('Unknown agent harness');
    });

    test('init prompt fetch fails: returns failure', async () => {
      (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('network error')
      );

      const result = await manager.ensureRunning(createOpts());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to fetch init prompt');
    });

    test('ensureRunning clears stuck stopping slot beyond timeout before spawning', async () => {
      await manager.ensureRunning(createOpts());
      (deps.logEvent as ReturnType<typeof vi.fn>).mockClear();
      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      slot.state = 'stopping';
      slot.stoppingSince = Date.now() - STOPPING_TIMEOUT_MS - 1_000;
      slot.pendingOperation = new Promise(() => {}); // simulate hung doStop

      const result = await manager.ensureRunning(createOpts());

      expect(result).toEqual({ success: true, pid: PID });
      expect(slot.state).toBe('running');
      expect(slot.pid).toBe(PID);
      expect(slot.stoppingSince).toBeUndefined();

      const timeoutExits = getLogEventCallsByArgs(
        deps,
        (args) => args.stopReason === 'daemon.stop_timeout' && args.pid === PID
      );
      expect(timeoutExits).toHaveLength(1);
    });
  });

  describe('stop intent fencing', () => {
    test('explicit user.start clears stop intent and allows ensureRunning', async () => {
      await manager.ensureRunning(createOpts());
      manager.markStopIntent(CHATROOM_ID, ROLE, 'user.stop', PID);

      const result = await manager.ensureRunning(createOpts({ reason: 'user.start' }));

      expect(result.success).toBe(true);
    });

    test('markChatroomStopIntent marks idle slots (post-recovery reset)', async () => {
      await manager.ensureRunning(createOpts());
      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      slot.state = 'idle';
      slot.pid = undefined;

      manager.markChatroomStopIntent(CHATROOM_ID, 'user.stop');

      expect(manager.isStopRequested(CHATROOM_ID, ROLE)).toBe(true);
    });
  });

  // ── stop ──────────────────────────────────────────────────────────────

  describe('stop', () => {
    test('running → stopping → idle: delegates to service.stop, emits exit event, clears disk', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;

      const result = await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      expect(result).toEqual({ success: true });
      expect(service.stop).toHaveBeenCalledWith(PID);
      expect(service.untrack).toHaveBeenCalledWith(PID);
      const killCalls = vi.mocked(deps.processes.kill).mock.calls.filter(([, sig]) => sig !== 0);
      expect(killCalls).toHaveLength(0);

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot!.state).toBe('idle');
      expect(slot!.pid).toBeUndefined();

      expect(deps.persistence.clearAgentPid).toHaveBeenCalledWith(
        'test-machine',
        CHATROOM_ID,
        ROLE
      );
    });

    test('doStop falls back to direct kill when harness service is not registered', async () => {
      await manager.ensureRunning(createOpts());
      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      slot.harness = 'cursor';

      let killed = false;
      (deps.processes.kill as ReturnType<typeof vi.fn>).mockImplementation(
        (pid: number, sig: string | number) => {
          if (sig === 0 && killed) throw new Error('ESRCH');
          if (sig === 'SIGTERM') killed = true;
        }
      );

      const service = deps.agentServices.get('opencode')!;
      const result = await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'daemon.shutdown',
      });

      expect(result).toEqual({ success: true });
      expect(deps.processes.kill).toHaveBeenCalledWith(-PID, 'SIGTERM');
      expect(service.stop).not.toHaveBeenCalled();
      expect(service.untrack).toHaveBeenCalledWith(PID);
    });

    test('already idle: returns success and notifies backend for cleanup', async () => {
      const result = await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      expect(result).toEqual({ success: true });

      expect(deps.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'test-session',
          machineId: 'test-machine',
          chatroomId: CHATROOM_ID,
          role: ROLE,
          pid: 0,
          stopReason: 'user.stop',
        })
      );

      expect(deps.lifecycleOutbox.enqueue).toHaveBeenCalledWith({
        kind: 'exited',
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: 0,
        stopReason: 'user.stop',
        revisionKey: expect.stringMatching(/^exited:/),
        emittedAt: expect.any(Number),
      });
      const enqueuedFact = vi.mocked(deps.lifecycleOutbox.enqueue).mock.calls.at(-1)?.[0];
      expect(enqueuedFact).not.toHaveProperty('sessionId');
      expect(enqueuedFact).not.toHaveProperty('machineId');
    });

    test('already idle with event PID: attempts to kill the process and reports exit with that PID', async () => {
      const result = await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
        pid: 12345,
      });

      expect(result).toEqual({ success: true });

      // Should attempt to kill the event PID
      expect(deps.processes.kill).toHaveBeenCalledWith(12345, 'SIGTERM');

      // Should report exit with the event PID, not 0
      expect(deps.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 12345,
          stopReason: 'user.stop',
        })
      );
    });

    test('already idle without event PID: reports exit with pid 0 (backward compat)', async () => {
      const result = await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      expect(result).toEqual({ success: true });

      // Should report exit with pid 0 (no PID available)
      expect(deps.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 0,
          stopReason: 'user.stop',
        })
      );
    });

    test('concurrent stop calls: second awaits first', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      let stopResolve: () => void;
      const stopGate = new Promise<void>((resolve) => {
        stopResolve = resolve;
      });
      (service.stop as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        (
          deps.processes.kill as typeof deps.processes.kill & { markDead: (pid: number) => void }
        ).markDead(PID);
        await stopGate;
      });

      const p1 = manager.stop({ chatroomId: CHATROOM_ID, role: ROLE, reason: 'user.stop' });
      const p2 = manager.stop({ chatroomId: CHATROOM_ID, role: ROLE, reason: 'user.stop' });

      stopResolve!();
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toEqual({ success: true });
      expect(r2).toEqual({ success: true });
      expect(service.stop).toHaveBeenCalledTimes(1);
    });

    test('stop + onExit callback does NOT produce duplicate exit events', async () => {
      // This tests the fix for the double agent.exited bug:
      // When stop() kills a process, the onExit callback also fires.
      // Only ONE log event should be made (from doStop), not two.
      await manager.ensureRunning(createOpts());

      // Capture the onExit callback registered during spawn
      const service = deps.agentServices.get('opencode')!;
      const spawnMockResult = (service.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
      const resolvedSpawn = await spawnMockResult;
      const registeredOnExit = (resolvedSpawn.onExit as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0];

      // Reset the log event mock to track calls from here
      (deps.logEvent as ReturnType<typeof vi.fn>).mockClear();

      // service.stop may trigger onExit while doStop owns the lifecycle
      (service.stop as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        (
          deps.processes.kill as typeof deps.processes.kill & { markDead: (pid: number) => void }
        ).markDead(PID);
        if (registeredOnExit) {
          registeredOnExit({ code: null, signal: 'SIGTERM' });
        }
      });

      await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      // Count all log event calls — should be exactly 1 (from doStop only)
      // Before the fix, handleExit would also fire, producing 2 calls
      await vi.waitFor(() => expect(deps.logEvent).toHaveBeenCalledTimes(1));
    });
  });

  describe('clearStuckStoppingSlot', () => {
    test('force-clears stopping slot older than timeout and records exit', async () => {
      await manager.ensureRunning(createOpts());
      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      slot.state = 'stopping';
      slot.stoppingSince = Date.now() - 31_000;
      slot.pendingOperation = new Promise(() => {});

      (deps.logEvent as ReturnType<typeof vi.fn>).mockClear();

      const cleared = await manager.clearStuckStoppingSlot(CHATROOM_ID, ROLE);

      expect(cleared).toBe(true);
      expect(slot.state).toBe('idle');
      expect(slot.pid).toBeUndefined();
      expect(slot.stoppingSince).toBeUndefined();
      expect(deps.persistence.clearAgentPid).toHaveBeenCalledWith(
        'test-machine',
        CHATROOM_ID,
        ROLE
      );
      expect(deps.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent.stopTimeout',
          chatroomId: CHATROOM_ID,
          role: ROLE,
          pid: PID,
          durationMs: expect.any(Number),
        })
      );
      expect(deps.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent.exited',
          chatroomId: CHATROOM_ID,
          role: ROLE,
          pid: PID,
          stopReason: 'daemon.stop_timeout',
          signal: 'SIGKILL',
        })
      );
    });

    test('can clear stale stop intent for task-delivery recovery', async () => {
      await manager.ensureRunning(createOpts());
      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      manager.markStopIntent(CHATROOM_ID, ROLE, 'user.stop', slot.pid);
      slot.state = 'stopping';
      slot.stoppingSince = Date.now() - 31_000;

      const cleared = await manager.clearStuckStoppingSlot(CHATROOM_ID, ROLE, {
        clearStopIntent: true,
      });

      expect(cleared).toBe(true);
      expect(manager.isStopRequested(CHATROOM_ID, ROLE)).toBe(false);
      const result = await manager.ensureRunning(
        createOpts({ reason: 'platform.task_monitor_nudge' })
      );
      expect(result.success).toBe(true);
    });

    test('preserves a new stop intent requested during force-clear cleanup', async () => {
      await manager.ensureRunning(createOpts());
      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      manager.markStopIntent(CHATROOM_ID, ROLE, 'user.stop', slot.pid);
      slot.state = 'stopping';
      slot.stoppingSince = Date.now() - 31_000;

      let finishPidCleanup!: () => void;
      const pidCleanup = new Promise<void>((resolve) => {
        finishPidCleanup = resolve;
      });
      (deps.persistence.clearAgentPid as ReturnType<typeof vi.fn>).mockReturnValueOnce(pidCleanup);

      const clearing = manager.clearStuckStoppingSlot(CHATROOM_ID, ROLE, {
        clearStopIntent: true,
      });
      await vi.waitFor(() => expect(slot.state).toBe('idle'));

      manager.markStopIntent(CHATROOM_ID, ROLE, 'user.stop');
      finishPidCleanup();
      await clearing;

      expect(manager.isStopRequested(CHATROOM_ID, ROLE)).toBe(true);
      expect(slot.expectedStopReason).toBe('user.stop');
    });

    test('does not clear stopping slot within timeout window', async () => {
      await manager.ensureRunning(createOpts());
      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      slot.state = 'stopping';
      slot.stoppingSince = Date.now() - 5_000;

      const cleared = await manager.clearStuckStoppingSlot(CHATROOM_ID, ROLE);

      expect(cleared).toBe(false);
      expect(slot.state).toBe('stopping');
    });

    test('force-clear supersedes in-flight doStop so late completion does not wipe revived slot', async () => {
      await manager.ensureRunning(createOpts());
      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      const NEW_PID = 99;

      let resolveStop!: () => void;
      const hungStop = new Promise<void>((resolve) => {
        resolveStop = resolve;
      });
      const service = deps.agentServices.get('opencode')!;
      (service.stop as ReturnType<typeof vi.fn>).mockReturnValue(hungStop);

      const stopInFlight = manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      expect(slot.state).toBe('stopping');
      slot.stoppingSince = Date.now() - 31_000;

      (deps.logEvent as ReturnType<typeof vi.fn>).mockClear();

      const cleared = await manager.clearStuckStoppingSlot(CHATROOM_ID, ROLE);
      expect(cleared).toBe(true);
      expect(slot.state).toBe('idle');

      slot.state = 'running';
      slot.pid = NEW_PID;
      slot.harness = 'opencode';

      resolveStop();
      await stopInFlight;

      expect(slot.state).toBe('running');
      expect(slot.pid).toBe(NEW_PID);

      const userStopExits = getLogEventCallsByArgs(
        deps,
        (args) => args.stopReason === 'user.stop' && args.pid === PID
      );
      expect(userStopExits).toHaveLength(0);

      const timeoutExits = getLogEventCallsByArgs(
        deps,
        (args) => args.stopReason === 'daemon.stop_timeout' && args.pid === PID
      );
      expect(timeoutExits).toHaveLength(1);
    });
  });

  // ── handleExit ────────────────────────────────────────────────────────

  describe('handleExit', () => {
    test('stale PID is ignored', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();

      // Simulate exit with WRONG PID — should be ignored
      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: 99999, // Different from PID (42)
        code: 1,
        signal: null,
      });

      // Slot should remain running
      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot!.state).toBe('running');
      expect(slot!.pid).toBe(PID);
      expect(service.spawn).not.toHaveBeenCalled();
    });

    test('exit without harness/workingDir does not restart', async () => {
      // Manually set a slot without workingDir
      await manager.ensureRunning(createOpts());

      // Hack: remove workingDir from slot to simulate edge case
      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      slot.workingDir = undefined;

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();

      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 1,
        signal: null,
      });

      // Should NOT restart since workingDir is missing
      // Wait a tick for any async work
      await new Promise((r) => setTimeout(r, 10));
      expect(service.spawn).not.toHaveBeenCalled();
    });

    test('crash after previous stop does not leak stale stop reason', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;

      // Stop the agent intentionally (user.stop)
      await manager.stop({ chatroomId: CHATROOM_ID, role: ROLE, reason: 'user.stop' });

      // Restart the agent
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();
      (service.spawn as ReturnType<typeof vi.fn>).mockResolvedValue({
        pid: 200,
        workingDir: '/test/work',
      });
      await manager.ensureRunning(createOpts());

      // Clear log-event mock to isolate the exit event we care about
      (deps.logEvent as ReturnType<typeof vi.fn>).mockClear();

      // Now let it crash — the stop reason should be derived from exit info,
      // NOT leaked from the previous user.stop
      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: 200,
        code: 1,
        signal: null,
      });

      // Verify the log event was emitted with agent_process.crashed
      await vi.waitFor(() => {
        const exitCall = (deps.logEvent as ReturnType<typeof vi.fn>).mock.calls.find(
          (c: unknown[]) =>
            c[0] &&
            typeof c[0] === 'object' &&
            (c[0] as Record<string, unknown>).stopReason !== undefined
        );
        expect(exitCall).toBeDefined();
        expect((exitCall![0] as Record<string, unknown>).stopReason).toBe('agent_process.crashed');
      });
    });




    test('onAgentEnd with rate-limit logs still completes native turn end', async () => {
      const resumeTurn = vi.fn();
      let agentEndCb: (() => void) | undefined;
      const resumableService = {
        ...createMockService(),
        id: 'opencode-sdk',
        resumeTurn,
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'sess-opencode-1',
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onLogLine: vi.fn(),
          onAgentEnd: vi.fn((cb: () => void) => {
            agentEndCb = cb;
          }),
        }),
      };
      deps.agentServices = new Map([['opencode-sdk', resumableService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(
        createOpts({ agentHarness: 'opencode-sdk' as EnsureRunningOpts['agentHarness'] })
      );

      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      slot.recentLogLines = [
        '[ts] role:builder error] AI_APICallError: Rate limit exceeded. Please try again later.',
      ];

      await triggerAgentEnd(manager, agentEndCb!);

      expect(resumeTurn).not.toHaveBeenCalled();
      expect(
        getMutationCallsByArgs(
          deps,
          (args) => typeof args.error === 'string' && args.error.includes('non-retryable')
        )
      ).toHaveLength(0);
    });

    test('onAgentEnd with model load failure logs still completes native turn end', async () => {
      const resumeTurn = vi.fn();
      let agentEndCb: (() => void) | undefined;
      const resumableService = {
        ...createMockService(),
        id: 'opencode-sdk',
        resumeTurn,
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'sess-opencode-1',
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onLogLine: vi.fn(),
          onAgentEnd: vi.fn((cb: () => void) => {
            agentEndCb = cb;
          }),
        }),
      };
      deps.agentServices = new Map([['opencode-sdk', resumableService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(
        createOpts({ agentHarness: 'opencode-sdk' as EnsureRunningOpts['agentHarness'] })
      );

      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      slot.recentLogLines = [
        '[ts] role:builder error] Failed to load model "qwen/qwen3.6-35b-a3b". Model loading was stopped due to insufficient system resources.',
      ];

      await triggerAgentEnd(manager, agentEndCb!);

      expect(resumeTurn).not.toHaveBeenCalled();
      expect(
        getMutationCallsByArgs(
          deps,
          (args) => typeof args.error === 'string' && args.error.includes('Failed to load model')
        )
      ).toHaveLength(0);
    });



  });

  // ── listActive ────────────────────────────────────────────────────────

  describe('listActive', () => {
    test('returns running and spawning slots', async () => {
      await manager.ensureRunning(createOpts());
      await manager.ensureRunning(createOpts({ chatroomId: 'other-room', role: 'architect' }));

      const active = manager.listActive();
      expect(active).toHaveLength(2);
      expect(active.map((a) => a.role)).toContain('builder');
      expect(active.map((a) => a.role)).toContain('architect');
    });

    test('does not include idle slots', async () => {
      // Create and then exit an agent
      await manager.ensureRunning(createOpts());
      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 1,
        signal: null,
      });

      // Wait for the restart attempt to complete (or fail due to spawning)
      await new Promise((r) => setTimeout(r, 50));

      // The slot might be running again due to auto-restart. Let's check differently:
      // Just verify listActive works
      const active = manager.listActive();
      for (const entry of active) {
        expect(['running', 'spawning']).toContain(entry.slot.state);
      }
    });
  });

  // ── nativeTurnPhase transitions ───────────────────────────────────────

  describe('nativeTurnPhase', () => {
    test.each(NATIVE_DIRECT_HARNESS_NAMES)(
      'spawn sets nativeTurnPhase to idle for %s',
      async (harness) => {
        const { service } = createNativeSdkService(harness);
        deps.agentServices = new Map([[harness, service]]);
        manager = new AgentProcessManager(deps);

        await manager.ensureRunning(
          createOpts({ agentHarness: harness as EnsureRunningOpts['agentHarness'] })
        );

        const slot = manager.getSlot(CHATROOM_ID, ROLE);
        expect(slot?.nativeTurnPhase).toBe('idle');
      }
    );

    test.each(NATIVE_DIRECT_HARNESS_NAMES)(
      'resumeTurnForSlot transitions injecting → turn_in_flight for %s',
      async (harness) => {
        const { service, resumeTurn } = createNativeSdkService(harness);
        deps.agentServices = new Map([[harness, service]]);
        manager = new AgentProcessManager(deps);

        await manager.ensureRunning(
          createOpts({ agentHarness: harness as EnsureRunningOpts['agentHarness'] })
        );

        await manager.resumeTurnForSlot({
          chatroomId: CHATROOM_ID,
          role: ROLE,
          prompt: 'Continue working',
        });

        const slot = manager.getSlot(CHATROOM_ID, ROLE);
        expect(resumeTurn).toHaveBeenCalled();
        expect(slot?.nativeTurnPhase).toBe('turn_in_flight');
      }
    );

    test.each(NATIVE_DIRECT_HARNESS_NAMES)(
      'resumeTurnForSlot sets idle on failure for %s',
      async (harness) => {
        const resumeTurn = vi.fn().mockRejectedValue(new Error('connection lost'));
        const onAgentEndRegistrar = vi.fn();
        const service = {
          ...createMockService(),
          id: harness,
          resumeTurn,
          spawn: vi.fn().mockResolvedValue({
            pid: PID,
            harnessSessionId: `sess-${harness}-1`,
            onExit: vi.fn(),
            onOutput: vi.fn(),
            onAgentEnd: onAgentEndRegistrar,
          }),
        };
        deps.agentServices = new Map([[harness, service]]);
        manager = new AgentProcessManager(deps);

        await manager.ensureRunning(
          createOpts({ agentHarness: harness as EnsureRunningOpts['agentHarness'] })
        );

        await expect(
          manager.resumeTurnForSlot({
            chatroomId: CHATROOM_ID,
            role: ROLE,
            prompt: 'Continue working',
          })
        ).rejects.toThrow('connection lost');

        const slot = manager.getSlot(CHATROOM_ID, ROLE);
        expect(slot?.nativeTurnPhase).toBe('idle');
      }
    );

    test('non-native harness does not set nativeTurnPhase', async () => {
      await manager.ensureRunning(createOpts());

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot?.nativeTurnPhase).toBeUndefined();
    });
  });

  // ── exitRetryQueue ────────────────────────────────────────────────────

  describe('exitRetryQueue', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('queues exit event for retry when recordAgentExited fails in handleExit', async () => {
      const logEvent = vi.fn().mockResolvedValue(undefined);
      // Allow first spawn, then block restarts
      const shouldAllowSpawn = vi
        .fn()
        .mockReturnValueOnce({ allowed: true }) // first spawn succeeds
        .mockReturnValue({ allowed: false, retryAfterMs: 60_000 }); // no restarts

      const localDeps = createDeps({
        backend: {
          query: vi.fn().mockResolvedValue({
            prompt: true,
            rolePrompt: 'You are a builder',
            initialMessage: 'Start working',
          }),
          mutation: mockBackendMutation({}),
        },
        logEvent,
        spawning: {
          shouldAllowSpawn,
        },
      });
      const localManager = new AgentProcessManager(localDeps);

      // Spawn agent
      const result = await localManager.ensureRunning(createOpts());
      expect(result.success).toBe(true);

      // recordAgentExited fails on the next call
      logEvent.mockRejectedValueOnce(new Error('fetch failed'));

      const callsBeforeExit = logEvent.mock.calls.length;

      // Trigger exit
      localManager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 0,
        signal: null,
      });

      // Let the promise rejection propagate
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // recordAgentExited was attempted (and failed)
      expect(logEvent.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeExit + 1);

      // Advance timers to trigger retry — retry should succeed now (mock returns resolved)
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // Verify a retry was attempted (at least one more mutation call)
      expect(logEvent.mock.calls.length).toBeGreaterThan(callsBeforeExit + 1);
    });

    test('removes item from retry queue on successful retry', async () => {
      const logEvent = vi.fn();
      // First: spawn-related mutations succeed
      const localDeps = createDeps({
        backend: {
          query: vi.fn().mockResolvedValue({
            prompt: true,
            rolePrompt: 'You are a builder',
            initialMessage: 'Start working',
          }),
          mutation: mockBackendMutation({}),
        },
        logEvent,
      });
      const localManager = new AgentProcessManager(localDeps);

      await localManager.ensureRunning(createOpts());

      // recordAgentExited fails first time
      logEvent.mockRejectedValueOnce(new Error('fetch failed'));

      localManager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 0,
        signal: null,
      });
      await Promise.resolve();
      await Promise.resolve();

      // Now retry succeeds
      logEvent.mockResolvedValueOnce(undefined);
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // After success, the timer should stop (advancing again won't trigger more mutations)
      const callCountAfterSuccess = logEvent.mock.calls.length;
      logEvent.mockResolvedValueOnce(undefined); // would be called if timer still running
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();

      // No additional calls — timer was stopped
      expect(logEvent.mock.calls.length).toBe(callCountAfterSuccess);
    });

    test('keeps item in retry queue when retry also fails', async () => {
      const logEvent = vi.fn();
      const localDeps = createDeps({
        backend: {
          query: vi.fn().mockResolvedValue({
            prompt: true,
            rolePrompt: 'You are a builder',
            initialMessage: 'Start working',
          }),
          mutation: mockBackendMutation({}),
        },
        logEvent,
      });
      const localManager = new AgentProcessManager(localDeps);

      await localManager.ensureRunning(createOpts());

      // Initial recordAgentExited fails
      logEvent.mockRejectedValueOnce(new Error('fetch failed'));
      localManager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 0,
        signal: null,
      });
      await Promise.resolve();
      await Promise.resolve();

      const callsAfterFirstFail = logEvent.mock.calls.length;

      // Retry also fails
      logEvent.mockRejectedValueOnce(new Error('still offline'));
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // A retry was attempted (mutation called again)
      expect(logEvent.mock.calls.length).toBeGreaterThan(callsAfterFirstFail);

      // Retry second time succeeds
      logEvent.mockResolvedValueOnce(undefined);
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // Timer should stop now
      const callCountAfterSecondSuccess = logEvent.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      expect(logEvent.mock.calls.length).toBe(callCountAfterSecondSuccess);
    });

    test('queues multiple failed exit events independently', async () => {
      const logEvent = vi.fn();
      const localDeps = createDeps({
        backend: {
          query: vi.fn().mockResolvedValue({
            prompt: true,
            rolePrompt: 'You are a builder',
            initialMessage: 'Start working',
          }),
          mutation: mockBackendMutation({}),
        },
        logEvent,
      });
      const localManager = new AgentProcessManager(localDeps);

      // Spawn two agents
      await localManager.ensureRunning(createOpts({ chatroomId: 'room-1', role: 'builder' }));
      await localManager.ensureRunning(createOpts({ chatroomId: 'room-2', role: 'builder' }));

      // Both recordAgentExited calls fail
      logEvent.mockRejectedValueOnce(new Error('offline'));
      logEvent.mockRejectedValueOnce(new Error('offline'));

      localManager.handleExit({
        chatroomId: 'room-1',
        role: 'builder',
        pid: PID,
        code: 0,
        signal: null,
      });
      localManager.handleExit({
        chatroomId: 'room-2',
        role: 'builder',
        pid: PID,
        code: 0,
        signal: null,
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const callsBeforeRetry = logEvent.mock.calls.length;

      // Both retries succeed
      logEvent.mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // 2 additional retry calls were made
      expect(logEvent.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeRetry + 2);
    });
  });
});
