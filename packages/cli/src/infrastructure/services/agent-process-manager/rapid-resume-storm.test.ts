import { describe, expect, test, vi, beforeEach } from 'vitest';

import {
  AgentProcessManager,
  type AgentProcessManagerDeps,
  type EnsureRunningOpts,
} from './agent-process-manager.js';
import { CrashLoopTracker } from '../../machine/crash-loop-tracker.js';
import { RapidResumeTracker } from '../../machine/rapid-resume-tracker.js';

const CHATROOM_ID = 'test-chatroom';
const ROLE = 'builder';
const PID = 42;

function createMockService() {
  return {
    id: 'pi',
    displayName: 'Pi',
    command: 'pi',
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

function createDeps(overrides?: Partial<AgentProcessManagerDeps>): AgentProcessManagerDeps {
  const now = 1_000_000;
  const mockService = createMockService();
  return {
    agentServices: new Map([['pi', mockService]]),
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
      now: vi.fn(() => now),
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

function createOpts(overrides?: Partial<EnsureRunningOpts>): EnsureRunningOpts {
  return {
    chatroomId: CHATROOM_ID,
    role: ROLE,
    agentHarness: 'pi',
    model: 'test-model',
    workingDir: '/tmp/test',
    reason: 'user.start',
    wantResume: false,
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

describe('AgentProcessManager rapid resume storm wiring', () => {
  let deps: AgentProcessManagerDeps;
  let manager: AgentProcessManager;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
    manager = new AgentProcessManager(deps);
  });

  test('wires turn-end queue through to backend and stop on storm', async () => {
    const resumeTurn = vi.fn().mockResolvedValue(undefined);
    let agentEndCb: (() => void) | undefined;
    const piService = {
      ...createMockService(),
      resumeTurn,
      spawn: vi.fn().mockResolvedValue({
        pid: PID,
        harnessSessionId: 'pi-sess-storm',
        onExit: vi.fn(),
        onOutput: vi.fn(),
        onAgentEnd: vi.fn((cb: () => void) => {
          agentEndCb = cb;
        }),
        onLogLine: vi.fn((cb: (line: string) => void) => {
          cb('HTTP 429 rate limit exceeded');
        }),
      }),
    };
    deps.agentServices = new Map([['pi', piService]]);
    let tick = 1_000_000;
    deps.clock.now = vi.fn(() => tick);
    manager = new AgentProcessManager(deps);

    const result = await manager.ensureRunning(createOpts());
    expect(result.success).toBe(true);
    if (!agentEndCb) {
      throw new Error('onAgentEnd callback was not registered');
    }

    const threshold = new RapidResumeTracker().record('_', '_', 0).threshold;
    for (let i = 0; i < threshold; i++) {
      agentEndCb();
      tick += 200;
      await manager.whenTurnEndsIdle();
    }

    expect(resumeTurn.mock.calls.length).toBeLessThan(threshold);
    expect(
      getMutationCallsByArgs(
        deps,
        (args) => args.reason === 'rate_limit' && args.endCount === threshold
      )
    ).toHaveLength(1);
    expect(piService.stop).toHaveBeenCalled();
  });
});
