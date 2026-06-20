/* eslint-disable @typescript-eslint/no-non-null-assertion -- legacy slot access in integration-style tests */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

import {
  AgentProcessManager,
  type AgentProcessManagerDeps,
  type EnsureRunningOpts,
} from './agent-process-manager.js';
import { untrackChildPid } from '../../../commands/machine/daemon-start/handlers/orphan-tracker.js';
import type { HarnessSessionSnapshot } from '../../../domain/agent-lifecycle/index.js';
import { CRASH_LOOP_MAX_RESTARTS, CrashLoopTracker } from '../../machine/crash-loop-tracker.js';
import { RapidResumeTracker } from '../../machine/rapid-resume-tracker.js';
import { DEFAULT_TRIGGER_PROMPT } from '../remote-agents/spawn-prompt.js';

vi.mock('../../../commands/machine/daemon-start/handlers/orphan-tracker.js', () => ({
  trackChildPid: vi.fn(),
  untrackChildPid: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const CHATROOM_ID = 'test-chatroom';
const ROLE = 'builder';
const PID = 42;

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

function createDeps(overrides?: Partial<AgentProcessManagerDeps>): AgentProcessManagerDeps {
  const mockService = createMockService();
  return {
    agentServices: new Map([['opencode', mockService]]),
    backend: {
      query: vi.fn().mockResolvedValue({
        prompt: true,
        rolePrompt: 'You are a builder',
        initialMessage: 'Start working',
      }),
      mutation: vi.fn().mockResolvedValue(undefined),
    },
    sessionId: 'test-session',
    machineId: 'test-machine',
    processes: { kill: vi.fn() },
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
    crashLoop: new CrashLoopTracker(),
    convexUrl: 'http://test:3210',
    resumeStormTracker: new RapidResumeTracker(),
    ...overrides,
  };
}

async function triggerAgentEnd(manager: AgentProcessManager, cb: () => void): Promise<void> {
  cb();
  await manager.whenTurnEndsIdle();
}

function getLastHarnessSessions(manager: AgentProcessManager): Map<string, HarnessSessionSnapshot> {
  return (
    manager as unknown as {
      lastHarnessSessions: Map<string, HarnessSessionSnapshot>;
    }
  ).lastHarnessSessions;
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

    test('ensureRunning cursor-sdk emits native:waiting after spawn', async () => {
      const cursorSdkService = {
        ...createMockService(),
        id: 'cursor-sdk',
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        }),
      };
      deps.agentServices = new Map([['cursor-sdk', cursorSdkService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(
        createOpts({ agentHarness: 'cursor-sdk' as EnsureRunningOpts['agentHarness'] })
      );

      const nativeWaitingCalls = getMutationCallsByArgs(
        deps,
        (args) => args.action === 'native:waiting'
      );
      expect(nativeWaitingCalls).toHaveLength(1);
      expect(nativeWaitingCalls[0]).toMatchObject({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        action: 'native:waiting',
      });
    });

    test('turn-end idle resume for cursor-sdk emits native:waiting', async () => {
      const resumeTurn = vi.fn().mockResolvedValue(undefined);
      let agentEndCb: (() => void) | undefined;
      const cursorSdkService = {
        ...createMockService(),
        id: 'cursor-sdk',
        resumeTurn,
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn((cb: () => void) => {
            agentEndCb = cb;
          }),
        }),
      };
      deps.agentServices = new Map([['cursor-sdk', cursorSdkService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(
        createOpts({ agentHarness: 'cursor-sdk' as EnsureRunningOpts['agentHarness'] })
      );
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockClear();

      await triggerAgentEnd(manager, () => agentEndCb!());

      const nativeWaitingCalls = getMutationCallsByArgs(
        deps,
        (args) => args.action === 'native:waiting'
      );
      expect(nativeWaitingCalls).toHaveLength(1);
    });

    test('onAgentEnd calls resumeTurn instead of kill for resumable harness', async () => {
      const resumeTurn = vi.fn().mockResolvedValue(undefined);
      const resumableService = {
        ...createMockService(),
        id: 'opencode-sdk',
        resumeTurn,
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'sess-opencode-1',
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn((cb: () => void) => {
            cb();
          }),
        }),
      };
      deps.agentServices = new Map([['opencode-sdk', resumableService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(
        createOpts({ agentHarness: 'opencode-sdk' as EnsureRunningOpts['agentHarness'] })
      );
      await manager.whenTurnEndsIdle();

      expect(resumeTurn).toHaveBeenCalledOnce();
      expect(resumeTurn.mock.calls[0][0]).toBe(PID);
      expect(resumeTurn.mock.calls[0][1]).toContain('injected automatically');
      expect(resumeTurn.mock.calls[0][1]).not.toContain('get-next-task');
      expect(deps.processes.kill).not.toHaveBeenCalled();
      const sessionResumedCalls = (
        deps.backend.mutation as ReturnType<typeof vi.fn>
      ).mock.calls.filter(
        (call: unknown[]) =>
          call.length >= 2 &&
          (call[1] as Record<string, unknown>)?.reason === undefined &&
          (call[1] as Record<string, unknown>)?.role === ROLE
      );
      expect(sessionResumedCalls.length).toBeGreaterThan(0);
      expect(
        getMutationCallsByArgs(
          deps,
          (args) =>
            args.role === ROLE &&
            args.chatroomId === CHATROOM_ID &&
            args.harnessSessionId === 'sess-opencode-1' &&
            args.reason === undefined
        )
      ).toHaveLength(1);
    });

    test('onAgentEnd emits sessionResumeFailed and kills when resumeTurn fails', async () => {
      const resumeTurn = vi.fn().mockRejectedValue(new Error('session not found'));
      const resumableService = {
        ...createMockService(),
        id: 'opencode-sdk',
        resumeTurn,
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'sess-opencode-1',
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn((cb: () => void) => {
            cb();
          }),
        }),
      };
      deps.agentServices = new Map([['opencode-sdk', resumableService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(
        createOpts({ agentHarness: 'opencode-sdk' as EnsureRunningOpts['agentHarness'] })
      );
      await manager.whenTurnEndsIdle();

      expect(resumeTurn).toHaveBeenCalledOnce();
      expect(deps.processes.kill).toHaveBeenCalledWith(-PID, 'SIGTERM');
      const sessionResumeFailedCalls = (
        deps.backend.mutation as ReturnType<typeof vi.fn>
      ).mock.calls.filter(
        (call: unknown[]) =>
          call.length >= 2 && (call[1] as Record<string, unknown>)?.reason === 'session not found'
      );
      expect(sessionResumeFailedCalls).toHaveLength(1);
      expect(sessionResumeFailedCalls[0][1]).toMatchObject({
        harnessSessionId: 'sess-opencode-1',
      });
    });

    test('onAgentEnd calls resumeTurn for cursor-sdk without harnessSessionId', async () => {
      const resumeTurn = vi.fn().mockResolvedValue(undefined);
      const resumableService = {
        ...createMockService(),
        id: 'cursor-sdk',
        resumeTurn,
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn((cb: () => void) => {
            cb();
          }),
        }),
      };
      deps.agentServices = new Map([['cursor-sdk', resumableService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(
        createOpts({ agentHarness: 'cursor-sdk' as EnsureRunningOpts['agentHarness'] })
      );
      await manager.whenTurnEndsIdle();

      expect(resumeTurn).toHaveBeenCalledOnce();
      expect(resumeTurn.mock.calls[0][0]).toBe(PID);
      expect(resumeTurn.mock.calls[0][1]).toContain('injected automatically');
      expect(resumeTurn.mock.calls[0][1]).not.toContain('get-next-task');
      expect(deps.processes.kill).not.toHaveBeenCalled();
    });

    test('onAgentEnd kills (no resume) for resumable harness when wantResume is false', async () => {
      const resumeTurn = vi.fn().mockResolvedValue(undefined);
      const onAgentEndRegistrar = vi.fn();
      const resumableService = {
        ...createMockService(),
        id: 'opencode-sdk',
        resumeTurn,
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'sess-opencode-1',
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: onAgentEndRegistrar,
        }),
      };
      deps.agentServices = new Map([['opencode-sdk', resumableService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(
        createOpts({
          agentHarness: 'opencode-sdk' as EnsureRunningOpts['agentHarness'],
          wantResume: false,
        })
      );

      const agentEndCb = onAgentEndRegistrar.mock.calls[0][0] as () => void;
      await triggerAgentEnd(manager, agentEndCb);

      expect(resumeTurn).not.toHaveBeenCalled();
      expect(deps.processes.kill).toHaveBeenCalledWith(-PID, 'SIGTERM');
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

    test('wantResume reconnects via resumeFromDaemonMemory after user.stop', async () => {
      const resumeFromDaemonMemory = vi.fn().mockResolvedValue({
        pid: PID,
        harnessSessionId: 'sess-1',
        harnessReconnect: { agentName: 'build', model: 'gpt-4' },
        onExit: vi.fn(),
        onOutput: vi.fn(),
        onAgentEnd: vi.fn(),
      });
      const opencodeSdkService = {
        ...createMockService(),
        id: 'opencode-sdk',
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'sess-1',
          harnessReconnect: { agentName: 'build', model: 'gpt-4' },
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        }),
        resumeFromDaemonMemory,
        getHarnessReconnectContext: vi.fn().mockReturnValue({ agentName: 'build' }),
      };
      deps.agentServices = new Map([['opencode-sdk', opencodeSdkService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(createOpts({ agentHarness: 'opencode-sdk', wantResume: false }));
      await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      const result = await manager.ensureRunning(
        createOpts({ agentHarness: 'opencode-sdk', wantResume: true })
      );

      expect(result).toEqual({ success: true, pid: PID });
      expect(opencodeSdkService.spawn).toHaveBeenCalledOnce();
      expect(resumeFromDaemonMemory).toHaveBeenCalledOnce();
      expect(manager.getSlot(CHATROOM_ID, ROLE)!.harnessSessionId).toBe('sess-1');

      const sessionResumedArgs = getMutationCallsByArgs(
        deps,
        (args) =>
          args.chatroomId === CHATROOM_ID &&
          args.role === ROLE &&
          args.reason === undefined &&
          args.harnessSessionId !== undefined
      );
      expect(sessionResumedArgs.some((args) => args.harnessSessionId === 'sess-1')).toBe(true);
    });

    test('cursor-sdk wantResume reconnects via resumeFromDaemonMemory after user.stop', async () => {
      const resumeFromDaemonMemory = vi.fn().mockResolvedValue({
        pid: PID,
        harnessSessionId: 'cursor-agent-1',
        harnessReconnect: { agentName: 'builder@c1', model: 'composer-2.5' },
        onExit: vi.fn(),
        onOutput: vi.fn(),
        onAgentEnd: vi.fn(),
      });
      const cursorSdkService = {
        ...createMockService(),
        id: 'cursor-sdk',
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'cursor-agent-1',
          harnessReconnect: { agentName: 'builder@c1', model: 'composer-2.5' },
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        }),
        resumeFromDaemonMemory,
        getHarnessReconnectContext: vi.fn().mockReturnValue({
          agentName: 'builder@c1',
          model: 'composer-2.5',
        }),
      };
      deps.agentServices = new Map([['cursor-sdk', cursorSdkService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(createOpts({ agentHarness: 'cursor-sdk', wantResume: false }));
      await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      const result = await manager.ensureRunning(
        createOpts({ agentHarness: 'cursor-sdk', wantResume: true })
      );

      expect(result).toEqual({ success: true, pid: PID });
      expect(cursorSdkService.spawn).toHaveBeenCalledOnce();
      expect(resumeFromDaemonMemory).toHaveBeenCalledOnce();
      expect(manager.getSlot(CHATROOM_ID, ROLE)!.harnessSessionId).toBe('cursor-agent-1');

      const sessionResumedArgs = getMutationCallsByArgs(
        deps,
        (args) =>
          args.chatroomId === CHATROOM_ID &&
          args.role === ROLE &&
          args.reason === undefined &&
          args.harnessSessionId !== undefined
      );
      expect(sessionResumedArgs.some((args) => args.harnessSessionId === 'cursor-agent-1')).toBe(
        true
      );
    });

    test('pi wantResume reconnects via resumeFromDaemonMemory after user.stop', async () => {
      const resumeFromDaemonMemory = vi.fn().mockResolvedValue({
        pid: PID,
        harnessSessionId: 'pi-sess-1',
        harnessReconnect: { agentName: 'pi', model: 'anthropic/claude-3-5-sonnet' },
        onExit: vi.fn(),
        onOutput: vi.fn(),
        onAgentEnd: vi.fn(),
      });
      const piService = {
        ...createMockService(),
        id: 'pi',
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'pi-sess-1',
          harnessReconnect: { agentName: 'pi', model: 'anthropic/claude-3-5-sonnet' },
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        }),
        resumeFromDaemonMemory,
        getHarnessReconnectContext: vi.fn().mockReturnValue({
          agentName: 'pi',
          model: 'anthropic/claude-3-5-sonnet',
        }),
      };
      deps.agentServices = new Map([['pi', piService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(createOpts({ agentHarness: 'pi', wantResume: false }));
      await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      const result = await manager.ensureRunning(
        createOpts({ agentHarness: 'pi', wantResume: true })
      );

      expect(result).toEqual({ success: true, pid: PID });
      expect(piService.spawn).toHaveBeenCalledOnce();
      expect(resumeFromDaemonMemory).toHaveBeenCalledOnce();
      expect(manager.getSlot(CHATROOM_ID, ROLE)!.harnessSessionId).toBe('pi-sess-1');

      const sessionResumedArgs = getMutationCallsByArgs(
        deps,
        (args) =>
          args.chatroomId === CHATROOM_ID &&
          args.role === ROLE &&
          args.reason === undefined &&
          args.harnessSessionId !== undefined
      );
      expect(sessionResumedArgs.some((args) => args.harnessSessionId === 'pi-sess-1')).toBe(true);
    });

    test('wantResume with no daemon memory spawns fresh without sessionResumeFailed', async () => {
      const opencodeSdkService = {
        ...createMockService(),
        id: 'opencode-sdk',
        resumeFromDaemonMemory: vi.fn(),
      };
      deps.agentServices = new Map([['opencode-sdk', opencodeSdkService]]);
      manager = new AgentProcessManager(deps);

      const result = await manager.ensureRunning(
        createOpts({ agentHarness: 'opencode-sdk', wantResume: true })
      );

      expect(result).toEqual({ success: true, pid: PID });
      expect(opencodeSdkService.spawn).toHaveBeenCalledOnce();
      expect(opencodeSdkService.resumeFromDaemonMemory).not.toHaveBeenCalled();
      const sessionResumeFailedCalls = getMutationCallsByArgs(
        deps,
        (args) =>
          typeof args.reason === 'string' && args.pid === undefined && args.stopReason === undefined
      );
      expect(sessionResumeFailedCalls).toHaveLength(0);
    });

    test('wantResume clears daemon memory and emits sessionResumeFailed when workingDir changed', async () => {
      const resumeFromDaemonMemory = vi.fn();
      const opencodeSdkService = {
        ...createMockService(),
        id: 'opencode-sdk',
        resumeFromDaemonMemory,
      };
      deps.agentServices = new Map([['opencode-sdk', opencodeSdkService]]);
      manager = new AgentProcessManager(deps);

      const key = `${CHATROOM_ID}:${ROLE.toLowerCase()}`;
      getLastHarnessSessions(manager).set(key, {
        harnessSessionId: 'sess-1',
        harness: 'opencode-sdk',
        agentName: 'build',
        workingDir: '/tmp/other',
      });

      const result = await manager.ensureRunning(
        createOpts({ agentHarness: 'opencode-sdk', wantResume: true, workingDir: '/tmp/test' })
      );

      expect(result).toEqual({ success: true, pid: PID });
      expect(resumeFromDaemonMemory).not.toHaveBeenCalled();
      expect(opencodeSdkService.spawn).toHaveBeenCalledOnce();
      expect(getLastHarnessSessions(manager).has(key)).toBe(false);
      const resumeFailedCalls = getMutationCallsByArgs(
        deps,
        (args) => args.reason === 'working directory changed'
      );
      expect(resumeFailedCalls).toHaveLength(1);
      expect(resumeFailedCalls[0]).toMatchObject({
        harnessSessionId: 'sess-1',
      });
    });

    test('wantResume falls back to spawn when resumeFromDaemonMemory fails', async () => {
      const resumeFromDaemonMemory = vi
        .fn()
        .mockRejectedValue(new Error('OpenCode session sess-1 not found'));
      const opencodeSdkService = {
        ...createMockService(),
        id: 'opencode-sdk',
        resumeFromDaemonMemory,
        getHarnessReconnectContext: vi.fn().mockReturnValue({ agentName: 'build' }),
      };
      deps.agentServices = new Map([['opencode-sdk', opencodeSdkService]]);
      manager = new AgentProcessManager(deps);

      const key = `${CHATROOM_ID}:${ROLE.toLowerCase()}`;
      getLastHarnessSessions(manager).set(key, {
        harnessSessionId: 'sess-1',
        harness: 'opencode-sdk',
        agentName: 'build',
        workingDir: '/tmp/test',
      });

      const result = await manager.ensureRunning(
        createOpts({ agentHarness: 'opencode-sdk', wantResume: true })
      );

      expect(result).toEqual({ success: true, pid: PID });
      expect(resumeFromDaemonMemory).toHaveBeenCalledOnce();
      expect(opencodeSdkService.spawn).toHaveBeenCalledOnce();
      const resumeFailedCalls = (
        deps.backend.mutation as ReturnType<typeof vi.fn>
      ).mock.calls.filter(
        (call: unknown[]) =>
          call.length >= 2 &&
          (call[1] as Record<string, unknown>)?.reason === 'OpenCode session sess-1 not found'
      );
      expect(resumeFailedCalls).toHaveLength(1);
      expect(resumeFailedCalls[0][1]).toMatchObject({
        harnessSessionId: 'sess-1',
      });
    });

    test('opencode-sdk spawn passes harnessSessionId to updateSpawnedAgent', async () => {
      const opencodeSdkService = {
        ...createMockService(),
        id: 'opencode-sdk',
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'sess-opencode-start',
          harnessReconnect: { agentName: 'build', model: 'gpt-4' },
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        }),
      };
      deps.agentServices = new Map([['opencode-sdk', opencodeSdkService]]);
      manager = new AgentProcessManager(deps);

      await manager.ensureRunning(createOpts({ agentHarness: 'opencode-sdk', wantResume: false }));

      const updateSpawnedCalls = getMutationCallsByArgs(
        deps,
        (args) => args.pid === PID && args.reason === 'user.start'
      );
      expect(updateSpawnedCalls).toHaveLength(1);
      expect(updateSpawnedCalls[0]).toMatchObject({
        pid: PID,
        harnessSessionId: 'sess-opencode-start',
      });
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
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockClear();

      const result = await manager.ensureRunning(createOpts());

      expect(result).toEqual({ success: true, pid: NEW_PID });
      expect(service.stop).toHaveBeenCalledWith(PID, { preserveForResume: false });
      expect(service.spawn).toHaveBeenCalledOnce();
      expect(manager.getSlot(CHATROOM_ID, ROLE)!.pid).toBe(NEW_PID);

      expect(deps.backend.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          pid: PID,
          stopReason: 'daemon.respawn',
        })
      );
    });

    test('persisted live PID without slot is killed before spawn', async () => {
      const ORPHAN_PID = 7777;
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
      expect(deps.backend.mutation).toHaveBeenCalledWith(
        expect.anything(),
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

    test('context auto-restart failure falls back to crash recovery (rate-limited)', async () => {
      const shouldAllowSpawn = deps.spawning.shouldAllowSpawn as ReturnType<typeof vi.fn>;
      shouldAllowSpawn.mockReturnValue({ allowed: true });

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('spawn error'))
        .mockResolvedValueOnce({
          pid: PID,
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        });

      const result = await manager.ensureRunning(
        createOpts({ reason: 'platform.auto_restart_on_new_context' })
      );

      expect(result).toEqual({ success: true, pid: PID });
      expect(shouldAllowSpawn).toHaveBeenCalledTimes(2);
      expect(shouldAllowSpawn).toHaveBeenNthCalledWith(
        1,
        CHATROOM_ID,
        'platform.auto_restart_on_new_context'
      );
      expect(shouldAllowSpawn).toHaveBeenNthCalledWith(2, CHATROOM_ID, 'platform.crash_recovery');
      expect(service.spawn).toHaveBeenCalledTimes(2);
    });

    test('context auto-restart: crash recovery failure returns rate_limited', async () => {
      const shouldAllowSpawn = deps.spawning.shouldAllowSpawn as ReturnType<typeof vi.fn>;
      shouldAllowSpawn
        .mockReturnValueOnce({ allowed: true })
        .mockReturnValueOnce({ allowed: false });

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('spawn error'));

      const result = await manager.ensureRunning(
        createOpts({ reason: 'platform.auto_restart_on_new_context' })
      );

      expect(result).toEqual({ success: false, error: 'rate_limited' });
      expect(shouldAllowSpawn).toHaveBeenCalledTimes(2);
      expect(service.spawn).toHaveBeenCalledTimes(1);
    });

    test('crash loop: returns failure, emits restartLimitReached', async () => {
      // Fill the window to max successful restarts: spacing must satisfy backoff (30s then 60s)
      // and keep all timestamps within CRASH_LOOP_WINDOW_MS so the limit check applies.
      const base = 1_700_000_000_000;
      const now = vi.mocked(deps.clock.now);
      now.mockReturnValue(base);
      deps.crashLoop.record(CHATROOM_ID, ROLE, base);
      let t = base + 30_000;
      for (let i = 1; i < CRASH_LOOP_MAX_RESTARTS; i++) {
        now.mockReturnValue(t);
        deps.crashLoop.record(CHATROOM_ID, ROLE, t);
        t += 60_000;
      }
      now.mockReturnValue(t);

      const result = await manager.ensureRunning(createOpts({ reason: 'platform.crash_recovery' }));

      expect(result.success).toBe(false);
      expect(result.error).toBe('crash_loop');

      // Should have emitted event
      expect(deps.backend.mutation).toHaveBeenCalledWith(
        expect.objectContaining({}),
        expect.objectContaining({
          chatroomId: CHATROOM_ID,
          role: ROLE,
          restartCount: expect.any(Number),
          windowMs: expect.any(Number),
        })
      );

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
      expect(service.stop).toHaveBeenCalledWith(PID, { preserveForResume: false });
      expect(service.untrack).toHaveBeenCalledWith(PID);
      expect(deps.processes.kill).not.toHaveBeenCalled();

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot!.state).toBe('idle');
      expect(slot!.pid).toBeUndefined();

      expect(deps.persistence.clearAgentPid).toHaveBeenCalledWith(
        'test-machine',
        CHATROOM_ID,
        ROLE
      );
    });

    test('user.stop with harnessSessionId passes preserveForResume to harness stop', async () => {
      const resumableService = {
        ...createMockService(),
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'sess-opencode-1',
          harnessReconnect: { agentName: 'build', model: 'gpt-4' },
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        }),
        getHarnessReconnectContext: vi.fn().mockReturnValue({
          agentName: 'build',
          model: 'anthropic/claude-sonnet-4',
        }),
      };
      const localDeps = {
        ...createDeps(),
        agentServices: new Map([['opencode-sdk', resumableService]]),
      };
      const localManager = new AgentProcessManager(localDeps);

      await localManager.ensureRunning({
        ...createOpts(),
        agentHarness: 'opencode-sdk',
      });

      await localManager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      expect(resumableService.stop).toHaveBeenCalledWith(PID, { preserveForResume: true });
      expect(resumableService.getHarnessReconnectContext).toHaveBeenCalledWith(PID);
      const key = `${CHATROOM_ID}:${ROLE.toLowerCase()}`;
      expect(getLastHarnessSessions(localManager).get(key)).toEqual({
        harnessSessionId: 'sess-opencode-1',
        harness: 'opencode-sdk',
        agentName: 'build',
        workingDir: '/tmp/test',
        model: 'gpt-4',
      });
    });

    test('platform stop clears daemon memory session context', async () => {
      const resumableService = {
        ...createMockService(),
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'sess-opencode-1',
          harnessReconnect: { agentName: 'build' },
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        }),
      };
      const localDeps = {
        ...createDeps(),
        agentServices: new Map([['opencode-sdk', resumableService]]),
      };
      const localManager = new AgentProcessManager(localDeps);

      await localManager.ensureRunning({
        ...createOpts(),
        agentHarness: 'opencode-sdk',
      });
      const key = `${CHATROOM_ID}:${ROLE.toLowerCase()}`;
      expect(getLastHarnessSessions(localManager).has(key)).toBe(true);

      await localManager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'daemon.shutdown',
      });

      expect(getLastHarnessSessions(localManager).has(key)).toBe(false);
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

      // Verify that recordAgentExited was called for idle cleanup
      expect(deps.backend.mutation).toHaveBeenCalledWith(
        expect.anything(), // api.machines.recordAgentExited
        expect.objectContaining({
          sessionId: 'test-session',
          machineId: 'test-machine',
          chatroomId: CHATROOM_ID,
          role: ROLE,
          pid: 0,
          stopReason: 'user.stop',
        })
      );
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
      expect(deps.backend.mutation).toHaveBeenCalledWith(
        expect.anything(),
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
      expect(deps.backend.mutation).toHaveBeenCalledWith(
        expect.anything(),
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
      // Only ONE recordAgentExited call should be made (from doStop), not two.
      await manager.ensureRunning(createOpts());

      // Capture the onExit callback registered during spawn
      const service = deps.agentServices.get('opencode')!;
      const spawnMockResult = (service.spawn as ReturnType<typeof vi.fn>).mock.results[0].value;
      const resolvedSpawn = await spawnMockResult;
      const registeredOnExit = (resolvedSpawn.onExit as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0];

      // Reset the backend mutation mock to track calls from here
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockClear();

      // service.stop may trigger onExit while doStop owns the lifecycle
      (service.stop as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        if (registeredOnExit) {
          registeredOnExit({ code: null, signal: 'SIGTERM' });
        }
      });

      await manager.stop({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        reason: 'user.stop',
      });

      // Count all backend.mutation calls — should be exactly 1 (from doStop only)
      // Before the fix, handleExit would also fire, producing 2 calls
      const mutationCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
      expect(mutationCalls).toHaveLength(1);
    });
  });

  // ── handleExit ────────────────────────────────────────────────────────

  describe('handleExit', () => {
    test('unexpected exit triggers auto restart', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;

      // Reset spawn mock for the restart call
      (service.spawn as ReturnType<typeof vi.fn>).mockResolvedValue({
        pid: 100,
        onExit: vi.fn(),
        onOutput: vi.fn(),
        onAgentEnd: vi.fn(),
      });

      // Simulate process exit directly via handleExit
      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 1,
        signal: null,
      });

      // Allow async restart to run
      await vi.waitFor(() => {
        expect(service.spawn).toHaveBeenCalledTimes(2); // original + restart
      });

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot!.state).toBe('running');
      expect(slot!.pid).toBe(100);
    });

    test('signal exit (SIGTERM) triggers restart (no stale reason leak)', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();

      // SIGTERM exit → agent_process.signal → should trigger restart
      // This verifies no stale state from prior stops leaks into the reason
      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 0,
        signal: 'SIGTERM',
      });

      // Should restart because agent_process.signal is a restartable reason
      await vi.waitFor(() => {
        expect(service.spawn).toHaveBeenCalledTimes(1);
      });
    });

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

      // Clear mutation mock to isolate the exit event we care about
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockClear();

      // Now let it crash — the stop reason should be derived from exit info,
      // NOT leaked from the previous user.stop
      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: 200,
        code: 1,
        signal: null,
      });

      // Verify the recordAgentExited mutation was called with agent_process.crashed
      await vi.waitFor(() => {
        const mutationCalls = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
        const exitCall = mutationCalls.find(
          (c: unknown[]) =>
            c[1] &&
            typeof c[1] === 'object' &&
            (c[1] as Record<string, unknown>).stopReason !== undefined
        );
        expect(exitCall).toBeDefined();
        expect((exitCall![1] as Record<string, unknown>).stopReason).toBe('agent_process.crashed');
      });
    });

    test('clean exit triggers restart', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();

      // Clean exit with code 0 → agent_process.exited_clean → triggers restart
      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 0,
        signal: null,
      });

      // Should restart (exited_clean is not intentional)
      await vi.waitFor(() => {
        expect(service.spawn).toHaveBeenCalledTimes(1);
      });
    });

    test('crash with permanent harness error does not restart', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockClear();

      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      slot.recentLogLines = [
        'Error: 400 {"error":{"message":"The requested model is not supported.","code":"model_not_supported","param":"model","type":"invalid_request_error"}}',
      ];

      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 1,
        signal: null,
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(service.spawn).not.toHaveBeenCalled();

      const startFailedCall = (deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) =>
          call[1] &&
          typeof call[1] === 'object' &&
          (call[1] as Record<string, unknown>).error !== undefined &&
          String((call[1] as Record<string, unknown>).error).includes('config_error')
      );
      expect(startFailedCall).toBeDefined();
    });

    test('onAgentEnd on provider rate limit emits startFailed once and skips exit re-emit', async () => {
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
      expect(deps.processes.kill).toHaveBeenCalledWith(-PID, 'SIGTERM');
      expect(slot.terminalProviderFailureHandled).toBe(true);

      const startFailedCalls = getMutationCallsByArgs(
        deps,
        (args) =>
          args.role === ROLE &&
          args.chatroomId === CHATROOM_ID &&
          typeof args.error === 'string' &&
          args.error.includes('non-retryable')
      );
      expect(startFailedCalls).toHaveLength(1);

      (resumableService.spawn as ReturnType<typeof vi.fn>).mockClear();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockClear();

      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: null,
        signal: 'SIGTERM',
      });

      await new Promise((r) => setTimeout(r, 20));

      expect(resumableService.spawn).not.toHaveBeenCalled();
      expect(
        getMutationCallsByArgs(
          deps,
          (args) => typeof args.error === 'string' && args.error.includes('non-retryable')
        )
      ).toHaveLength(0);
    });

    test('crash with provider rate limit emits startFailed once on exit path', async () => {
      await manager.ensureRunning(createOpts());

      const service = deps.agentServices.get('opencode')!;
      (service.spawn as ReturnType<typeof vi.fn>).mockClear();
      (deps.backend.mutation as ReturnType<typeof vi.fn>).mockClear();

      const slot = manager.getSlot(CHATROOM_ID, ROLE)!;
      slot.recentLogLines = [
        '[ts] role:builder error] AI_APICallError: Rate limit exceeded. Please try again later.',
      ];

      manager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 1,
        signal: null,
      });

      await new Promise((r) => setTimeout(r, 20));

      expect(service.spawn).not.toHaveBeenCalled();
      expect(
        getMutationCallsByArgs(
          deps,
          (args) => typeof args.error === 'string' && args.error.includes('non-retryable')
        )
      ).toHaveLength(1);
    });

    test('exited_clean retains daemon memory and reconnects cursor-sdk via resumeFromDaemonMemory', async () => {
      const resumeFromDaemonMemory = vi.fn().mockResolvedValue({
        pid: 100,
        harnessSessionId: 'cursor-agent-1',
        harnessReconnect: { agentName: 'builder@c1', model: 'composer-2.5' },
        onExit: vi.fn(),
        onOutput: vi.fn(),
        onAgentEnd: vi.fn(),
      });
      const cursorSdkService = {
        ...createMockService(),
        id: 'cursor-sdk',
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'cursor-agent-1',
          harnessReconnect: { agentName: 'builder@c1', model: 'composer-2.5' },
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        }),
        resumeFromDaemonMemory,
        getHarnessReconnectContext: vi.fn().mockReturnValue({
          agentName: 'builder@c1',
          model: 'composer-2.5',
        }),
      };
      const localDeps = {
        ...createDeps(),
        agentServices: new Map([['cursor-sdk', cursorSdkService]]),
      };
      const localManager = new AgentProcessManager(localDeps);

      await localManager.ensureRunning({
        ...createOpts(),
        agentHarness: 'cursor-sdk',
      });
      const key = `${CHATROOM_ID}:${ROLE.toLowerCase()}`;

      localManager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 0,
        signal: null,
      });

      await vi.waitFor(() => {
        expect(resumeFromDaemonMemory).toHaveBeenCalledOnce();
      });

      expect(cursorSdkService.spawn).toHaveBeenCalledOnce();
      expect(getLastHarnessSessions(localManager).get(key)).toEqual({
        harnessSessionId: 'cursor-agent-1',
        harness: 'cursor-sdk',
        agentName: 'builder@c1',
        workingDir: '/tmp/test',
        model: 'gpt-4',
      });
      expect(localManager.getSlot(CHATROOM_ID, ROLE)!.harnessSessionId).toBe('cursor-agent-1');
    });

    test('crash-recovery does not resume when wantResume is false', async () => {
      const resumeFromDaemonMemory = vi.fn().mockResolvedValue({
        pid: 100,
        harnessSessionId: 'sess-opencode-2',
        onExit: vi.fn(),
        onOutput: vi.fn(),
        onAgentEnd: vi.fn(),
      });
      const opencodeSdkService = {
        ...createMockService(),
        id: 'opencode-sdk',
        resumeTurn: vi.fn(),
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'sess-opencode-1',
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: vi.fn(),
        }),
        resumeFromDaemonMemory,
        getHarnessReconnectContext: vi.fn().mockReturnValue({ agentName: 'build' }),
      };
      const localDeps = {
        ...createDeps(),
        agentServices: new Map([['opencode-sdk', opencodeSdkService]]),
      };
      const localManager = new AgentProcessManager(localDeps);

      // Spawn with wantResume: false
      await localManager.ensureRunning({
        ...createOpts(),
        agentHarness: 'opencode-sdk',
        wantResume: false,
      });

      // Simulate a crash (SIGKILL — non-intentional exit)
      localManager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: null,
        signal: 'SIGKILL',
      });

      // Restart should happen (crash recovery triggers ensureRunning)
      await vi.waitFor(() => {
        expect(opencodeSdkService.spawn).toHaveBeenCalledTimes(2);
      });

      // But since wantResume was false, daemon-memory resume must NOT be used
      expect(resumeFromDaemonMemory).not.toHaveBeenCalled();
    });

    test('end-to-end: wantResume=false prevents both turn-resume and crash-recovery resume', async () => {
      const resumeTurn = vi.fn().mockResolvedValue(undefined);
      const resumeFromDaemonMemory = vi.fn().mockResolvedValue({
        pid: 200,
        harnessSessionId: 'sess-resumed',
        onExit: vi.fn(),
        onOutput: vi.fn(),
        onAgentEnd: vi.fn(),
      });
      const onAgentEndRegistrar = vi.fn();
      const opencodeSdkService = {
        ...createMockService(),
        id: 'opencode-sdk',
        resumeTurn,
        spawn: vi.fn().mockResolvedValue({
          pid: PID,
          harnessSessionId: 'sess-1',
          onExit: vi.fn(),
          onOutput: vi.fn(),
          onAgentEnd: onAgentEndRegistrar,
        }),
        resumeFromDaemonMemory,
        getHarnessReconnectContext: vi.fn().mockReturnValue({ agentName: 'test' }),
      };
      const localDeps = {
        ...createDeps(),
        agentServices: new Map([['opencode-sdk', opencodeSdkService]]),
      };
      const localManager = new AgentProcessManager(localDeps);

      // 1. Spawn with wantResume=false
      await localManager.ensureRunning({
        ...createOpts(),
        agentHarness: 'opencode-sdk',
        wantResume: false,
      });

      const slot = localManager.getSlot(CHATROOM_ID, ROLE)!;
      expect(slot.wantResume).toBe(false);

      // 2. Trigger agent_end (turn completion)
      const agentEndCb = onAgentEndRegistrar.mock.calls[0][0] as () => void;
      await triggerAgentEnd(localManager, agentEndCb);

      // 3. Verify: resumeTurn was NOT called (turn-resume path disabled)
      expect(resumeTurn).not.toHaveBeenCalled();
      expect(localDeps.processes.kill).toHaveBeenCalledWith(-PID, 'SIGTERM');

      // 4. Clear kill mock for next phase
      (localDeps.processes.kill as ReturnType<typeof vi.fn>).mockClear();
      (opencodeSdkService.spawn as ReturnType<typeof vi.fn>).mockClear();

      // 5. Simulate crash (non-intentional exit)
      localManager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 1,
        signal: null,
      });

      // 6. Wait for restart
      await vi.waitFor(() => {
        expect(opencodeSdkService.spawn).toHaveBeenCalledTimes(1);
      });

      // 7. Verify: daemon-memory resume was NOT used (crash-recovery respects wantResume=false)
      expect(resumeFromDaemonMemory).not.toHaveBeenCalled();

      // 8. Verify: fresh spawn happened instead (cold-start)
      expect(opencodeSdkService.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ role: ROLE }),
          model: expect.any(String),
          workingDir: expect.any(String),
        })
      );
    });
  });

  // ── recover ───────────────────────────────────────────────────────────

  describe('recover', () => {
    test('alive PIDs are killed and cleaned up (not restored as running)', async () => {
      (deps.persistence.listAgentEntries as ReturnType<typeof vi.fn>).mockResolvedValue([
        { chatroomId: CHATROOM_ID, role: ROLE, entry: { pid: 1234, harness: 'opencode' } },
      ]);

      // process.kill(pid, 0) succeeds → alive
      (deps.processes.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {});

      await manager.recover();

      expect(deps.processes.kill).toHaveBeenCalledWith(1234, 0);
      const service = deps.agentServices.get('opencode')!;
      expect(service.stop).toHaveBeenCalledWith(1234);
      expect(untrackChildPid).toHaveBeenCalledWith(1234);

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot).toBeUndefined();

      expect(deps.persistence.clearAgentPid).toHaveBeenCalledWith(
        'test-machine',
        CHATROOM_ID,
        ROLE
      );

      expect(deps.backend.mutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          chatroomId: CHATROOM_ID,
          role: ROLE,
          pid: 1234,
          stopReason: 'daemon.shutdown',
          agentHarness: 'opencode',
        })
      );
    });

    test('dead PIDs are cleaned up', async () => {
      (deps.persistence.listAgentEntries as ReturnType<typeof vi.fn>).mockResolvedValue([
        { chatroomId: CHATROOM_ID, role: ROLE, entry: { pid: 9999, harness: 'opencode' } },
      ]);

      // process.kill(pid, 0) throws → dead
      (deps.processes.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('ESRCH');
      });

      await manager.recover();

      const slot = manager.getSlot(CHATROOM_ID, ROLE);
      expect(slot).toBeUndefined(); // No slot created for dead process

      expect(deps.persistence.clearAgentPid).toHaveBeenCalledWith(
        'test-machine',
        CHATROOM_ID,
        ROLE
      );
    });
  });

  // ── listActive ────────────────────────────────────────────────────────

  describe('listActive', () => {
    test('returns running and spawning slots', async () => {
      await manager.ensureRunning(createOpts());
      await manager.ensureRunning(createOpts({ chatroomId: 'other-room', role: 'reviewer' }));

      const active = manager.listActive();
      expect(active).toHaveLength(2);
      expect(active.map((a) => a.role)).toContain('builder');
      expect(active.map((a) => a.role)).toContain('reviewer');
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

  // ── exitRetryQueue ────────────────────────────────────────────────────

  describe('exitRetryQueue', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('queues exit event for retry when recordAgentExited fails in handleExit', async () => {
      // Arrange: mutation mock — all calls succeed by default, except for recordAgentExited on first try
      const mutation = vi.fn().mockResolvedValue(undefined);
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
          mutation,
        },
        spawning: {
          shouldAllowSpawn,
        },
      });
      const localManager = new AgentProcessManager(localDeps);

      // Spawn agent
      const result = await localManager.ensureRunning(createOpts());
      expect(result.success).toBe(true);

      // recordAgentExited fails on the next call
      mutation.mockRejectedValueOnce(new Error('fetch failed'));

      const callsBeforeExit = mutation.mock.calls.length;

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
      expect(mutation.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeExit + 1);

      // Advance timers to trigger retry — retry should succeed now (mock returns resolved)
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // Verify a retry was attempted (at least one more mutation call)
      expect(mutation.mock.calls.length).toBeGreaterThan(callsBeforeExit + 1);
    });

    test('removes item from retry queue on successful retry', async () => {
      const mutation = vi.fn();
      // First: spawn-related mutations succeed
      const localDeps = createDeps({
        backend: {
          query: vi.fn().mockResolvedValue({
            prompt: true,
            rolePrompt: 'You are a builder',
            initialMessage: 'Start working',
          }),
          mutation,
        },
      });
      const localManager = new AgentProcessManager(localDeps);

      await localManager.ensureRunning(createOpts());

      // recordAgentExited fails first time
      mutation.mockRejectedValueOnce(new Error('fetch failed'));

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
      mutation.mockResolvedValueOnce(undefined);
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // After success, the timer should stop (advancing again won't trigger more mutations)
      const callCountAfterSuccess = mutation.mock.calls.length;
      mutation.mockResolvedValueOnce(undefined); // would be called if timer still running
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();

      // No additional calls — timer was stopped
      expect(mutation.mock.calls.length).toBe(callCountAfterSuccess);
    });

    test('keeps item in retry queue when retry also fails', async () => {
      const mutation = vi.fn();
      const localDeps = createDeps({
        backend: {
          query: vi.fn().mockResolvedValue({
            prompt: true,
            rolePrompt: 'You are a builder',
            initialMessage: 'Start working',
          }),
          mutation,
        },
      });
      const localManager = new AgentProcessManager(localDeps);

      await localManager.ensureRunning(createOpts());

      // Initial recordAgentExited fails
      mutation.mockRejectedValueOnce(new Error('fetch failed'));
      localManager.handleExit({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        pid: PID,
        code: 0,
        signal: null,
      });
      await Promise.resolve();
      await Promise.resolve();

      const callsAfterFirstFail = mutation.mock.calls.length;

      // Retry also fails
      mutation.mockRejectedValueOnce(new Error('still offline'));
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // A retry was attempted (mutation called again)
      expect(mutation.mock.calls.length).toBeGreaterThan(callsAfterFirstFail);

      // Retry second time succeeds
      mutation.mockResolvedValueOnce(undefined);
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // Timer should stop now
      const callCountAfterSecondSuccess = mutation.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      expect(mutation.mock.calls.length).toBe(callCountAfterSecondSuccess);
    });

    test('queues multiple failed exit events independently', async () => {
      const mutation = vi.fn();
      const localDeps = createDeps({
        backend: {
          query: vi.fn().mockResolvedValue({
            prompt: true,
            rolePrompt: 'You are a builder',
            initialMessage: 'Start working',
          }),
          mutation,
        },
      });
      const localManager = new AgentProcessManager(localDeps);

      // Spawn two agents
      await localManager.ensureRunning(createOpts({ chatroomId: 'room-1', role: 'builder' }));
      await localManager.ensureRunning(createOpts({ chatroomId: 'room-2', role: 'builder' }));

      // Both recordAgentExited calls fail
      mutation.mockRejectedValueOnce(new Error('offline'));
      mutation.mockRejectedValueOnce(new Error('offline'));

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

      const callsBeforeRetry = mutation.mock.calls.length;

      // Both retries succeed
      mutation.mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();

      // 2 additional retry calls were made
      expect(mutation.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeRetry + 2);
    });
  });
});
