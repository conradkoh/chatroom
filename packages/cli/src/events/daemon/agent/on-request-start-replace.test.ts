/**
 * Integration-style test: two agent.requestStart events for the same chatroom+role
 * result in a single live agent (second replaces first via kill-then-spawn).
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';

import {
  AgentProcessManager,
  type AgentProcessManagerDeps,
} from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';
import { CrashLoopTracker } from '../../../infrastructure/machine/crash-loop-tracker.js';
import { onRequestStartAgent } from './on-request-start-agent.js';
import type { DaemonContext } from '../../../commands/machine/daemon-start/types.js';
import type { AgentRequestStartEventPayload } from './on-request-start-agent.js';

const CHATROOM_ID = 'test-chatroom';
const ROLE = 'builder';
const FIRST_PID = 42;
const SECOND_PID = 99;

function createMockService() {
  return {
    id: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    isInstalled: vi.fn().mockResolvedValue(true),
    getVersion: vi.fn().mockResolvedValue({ version: '1.0.0', major: 1 }),
    listModels: vi.fn().mockResolvedValue([]),
    spawn: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    isAlive: vi.fn().mockReturnValue(false),
    getTrackedProcesses: vi.fn().mockReturnValue([]),
    untrack: vi.fn(),
  };
}

function createDeps(): AgentProcessManagerDeps {
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
      recordSpawn: vi.fn(),
      recordExit: vi.fn(),
    },
    crashLoop: new CrashLoopTracker(),
    convexUrl: 'http://test:3210',
  };
}

function createEvent(id: string): AgentRequestStartEventPayload {
  return {
    _id: id as AgentRequestStartEventPayload['_id'],
    chatroomId: CHATROOM_ID as AgentRequestStartEventPayload['chatroomId'],
    role: ROLE,
    agentHarness: 'opencode',
    model: 'gpt-4',
    workingDir: '/tmp/test',
    reason: 'user.start',
    deadline: Date.now() + 60_000,
  };
}

describe('onRequestStartAgent — replace on duplicate requestStart', () => {
  let deps: AgentProcessManagerDeps;
  let manager: AgentProcessManager;
  let ctx: DaemonContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
    manager = new AgentProcessManager(deps);
    const service = deps.agentServices.get('opencode')!;
    const spawn = service.spawn as ReturnType<typeof vi.fn>;
    spawn
      .mockResolvedValueOnce({
        pid: FIRST_PID,
        onExit: vi.fn(),
        onOutput: vi.fn(),
        onAgentEnd: vi.fn(),
      })
      .mockResolvedValueOnce({
        pid: SECOND_PID,
        onExit: vi.fn(),
        onOutput: vi.fn(),
        onAgentEnd: vi.fn(),
      });

    ctx = {
      sessionId: 'test-session',
      machineId: 'test-machine',
      config: {
        hostname: 'test-host',
        machineId: 'test-machine',
        availableHarnesses: ['opencode'] as never[],
        harnessVersions: {},
      },
      agentServices: deps.agentServices,
      lastPushedGitState: new Map(),
      lastPushedModels: null,
      lastPushedHarnessFingerprint: null,
      deps: {
        agentProcessManager: manager,
        backend: deps.backend,
      },
    } as unknown as DaemonContext;
  });

  test('second requestStart replaces first — single live agent in slot', async () => {
    await onRequestStartAgent(ctx, createEvent('evt-start-1'));
    await onRequestStartAgent(ctx, createEvent('evt-start-2'));

    const service = deps.agentServices.get('opencode')!;
    expect(service.spawn).toHaveBeenCalledTimes(2);
    expect(service.stop).toHaveBeenCalledWith(FIRST_PID, { preserveForResume: false });

    const slot = manager.getSlot(CHATROOM_ID, ROLE);
    expect(slot?.state).toBe('running');
    expect(slot?.pid).toBe(SECOND_PID);
    expect(slot?.pid).not.toBe(FIRST_PID);

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        pid: FIRST_PID,
        stopReason: 'daemon.respawn',
      })
    );
  });
});
