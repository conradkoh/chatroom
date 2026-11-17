/**
 * Regression: "Stop agents" (chatroom-wide stop) leaves agents running when
 * the agent was started with a working directory that has a trailing slash.
 *
 * The backend enqueues one workspace-scoped `agent.stop` per workspace and
 * sends `chatroom_workspaces.workingDir`, which `registerWorkspace` stores
 * normalized (no trailing slash). The daemon slot keeps the raw
 * `agent.requestStart.workingDir` from the launch request (which may end
 * with `/`). The daemon must treat both spellings as the same workspace.
 *
 * Only ports are substituted here: the agent process manager surface, the
 * OS process table, the harness service, and the lifecycle outbox. The real
 * `runRoleScopedStop` and `stopAgentTargets` pipeline runs.
 */
import { describe, expect, it, vi } from 'vitest';

import { executeChatroomStopCommand } from './execute-chatroom-stop-command.js';
import { buildStopTargetDescriptor } from '../services/agent-process-service/index.js';

const ROOM = 'room-1';
const SLOT_WORKING_DIR = '/Users/me/project/';
const WORKSPACE_WORKING_DIR = '/Users/me/project';
const OTHER_WORKING_DIR = '/Users/me/other-project';

function defaultTargets() {
  return [
    buildStopTargetDescriptor({
      machineId: 'machine-1',
      chatroomId: ROOM,
      role: 'coordinator',
      pid: 101,
      agentHarness: 'claude-sdk',
      workingDir: SLOT_WORKING_DIR,
    }),
    buildStopTargetDescriptor({
      machineId: 'machine-1',
      chatroomId: ROOM,
      role: 'architect',
      pid: 102,
      agentHarness: 'claude-sdk',
      workingDir: SLOT_WORKING_DIR,
    }),
  ];
}

function setup(
  options: { targets?: ReturnType<typeof defaultTargets>; alivePids?: number[] } = {}
) {
  const targets = options.targets ?? defaultTargets();
  const alive = new Set<number>(options.alivePids ?? targets.map((target) => target.pid));
  const harnessService = {
    stop: vi.fn(async (pid: number) => {
      alive.delete(pid);
    }),
    untrack: vi.fn(),
  };
  const processes = {
    kill: (pid: number, signal?: number | string) => {
      if (signal === 0 && !alive.has(pid)) {
        const error = new Error('ESRCH') as NodeJS.ErrnoException;
        error.code = 'ESRCH';
        throw error;
      }
    },
  };
  const lifecycleEnqueue = vi.fn(async (_fact: unknown) => ({ success: true }));
  const apm = {
    markStopIntent: vi.fn(),
    markChatroomStopIntent: vi.fn(),
    discoverStopTargets: vi.fn(async () => targets.filter((target) => alive.has(target.pid))),
    getConfirmedStopAdapterDeps: () => ({
      machineId: 'machine-1',
      sessionId: 'session-1',
      agentServices: new Map([['claude-sdk', harnessService]]),
      processes,
      lifecycleOutbox: { enqueue: lifecycleEnqueue },
      logEvent: async () => {},
      clock: { now: () => 1 },
      killProcessWithFallback: async (pid: number) => {
        alive.delete(pid);
      },
    }),
  };
  const nativeDelivery = {
    prepareRoleRecovery: vi.fn(async () => {}),
    recoverStoppedRole: vi.fn(async () => {}),
  };
  const taskService = { listMachineTaskRolesForChatroom: vi.fn(async () => []) };
  const runSerializedForAgent = vi.fn(async (_key, _options, operation) =>
    operation({}, { signal: new AbortController().signal })
  );
  return {
    alive,
    apm,
    harnessService,
    lifecycleEnqueue,
    nativeDelivery,
    runSerializedForAgent,
    taskService,
    run: (workingDir: string) =>
      executeChatroomStopCommand({
        apm,
        chatroomId: ROOM,
        commandId: 'command-1',
        workingDir,
        runSerializedForAgent,
        nativeDelivery,
        taskService,
      } as never),
  };
}

describe('executeChatroomStopCommand working-directory matching', () => {
  it('control: stops every agent when the stop command uses the slot spelling', async () => {
    const state = setup();
    await state.run(SLOT_WORKING_DIR);
    expect(state.harnessService.stop).toHaveBeenCalledTimes(2);
    expect([...state.alive]).toEqual([]);
  });

  it('stops every agent when the workspace path lacks the slot trailing slash', async () => {
    const state = setup();
    await state.run(WORKSPACE_WORKING_DIR);
    expect(state.harnessService.stop).toHaveBeenCalledTimes(2);
    expect([...state.alive]).toEqual([]);
  });

  it('does not stop agents in another workspace', async () => {
    const state = setup();
    await state.run(OTHER_WORKING_DIR);
    expect(state.harnessService.stop).not.toHaveBeenCalled();
    expect([...state.alive]).toEqual([101, 102]);
  });

  it('recovers stopped roles and acknowledges the stop command', async () => {
    const state = setup();
    await expect(state.run(WORKSPACE_WORKING_DIR)).resolves.toBeUndefined();
    expect(state.nativeDelivery.recoverStoppedRole).toHaveBeenCalledWith({
      chatroomId: ROOM,
      role: 'coordinator',
      mode: 'explicit',
    });
    expect(state.nativeDelivery.recoverStoppedRole).toHaveBeenCalledWith({
      chatroomId: ROOM,
      role: 'architect',
      mode: 'explicit',
    });
    const shutdownCalls = state.lifecycleEnqueue.mock.calls.filter(
      ([fact]) =>
        typeof fact === 'object' &&
        fact !== null &&
        'kind' in fact &&
        fact.kind === 'chatroom_shutdown_complete'
    );
    expect(shutdownCalls).toHaveLength(1);
    expect(state.lifecycleEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'chatroom_shutdown_complete', commandId: 'command-1' })
    );
  });

  it('uses the matched slot spelling for stop intent and serialization', async () => {
    const state = setup();
    await state.run(WORKSPACE_WORKING_DIR);
    const markStopIntentCalls = state.apm.markStopIntent.mock.calls;
    expect(markStopIntentCalls.length).toBeGreaterThan(0);
    expect(markStopIntentCalls.map((call) => call[4])).toEqual(
      markStopIntentCalls.map(() => '/Users/me/project/')
    );
    for (const call of state.runSerializedForAgent.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ workingDir: '/Users/me/project/' }));
    }
  });

  it('stops both spellings when one role has two slot spellings', async () => {
    const state = setup({
      targets: [
        buildStopTargetDescriptor({
          machineId: 'machine-1',
          chatroomId: ROOM,
          role: 'coordinator',
          pid: 101,
          agentHarness: 'claude-sdk',
          workingDir: '/Users/me/project/',
        }),
        buildStopTargetDescriptor({
          machineId: 'machine-1',
          chatroomId: ROOM,
          role: 'coordinator',
          pid: 103,
          agentHarness: 'claude-sdk',
          workingDir: '/Users/me/project',
        }),
      ],
      alivePids: [101, 103],
    });
    await state.run('/Users/me/project');
    expect(state.harnessService.stop).toHaveBeenCalledTimes(2);
    expect([...state.alive]).toEqual([]);
    expect(state.apm.markStopIntent).toHaveBeenCalledWith(
      'room-1',
      'coordinator',
      'user.stop',
      undefined,
      '/Users/me/project/'
    );
    expect(state.apm.markStopIntent).toHaveBeenCalledWith(
      'room-1',
      'coordinator',
      'user.stop',
      103,
      '/Users/me/project'
    );
  });

  it('still throws when a live process remains outside the requested scope', async () => {
    const state = setup({
      targets: [
        buildStopTargetDescriptor({
          machineId: 'machine-1',
          chatroomId: ROOM,
          role: 'coordinator',
          pid: 101,
          agentHarness: 'claude-sdk',
          workingDir: '/Users/me/project/',
        }),
        buildStopTargetDescriptor({
          machineId: 'machine-1',
          chatroomId: ROOM,
          role: 'coordinator',
          pid: 104,
          agentHarness: 'claude-sdk',
          workingDir: '/Users/me/other-project',
        }),
      ],
      alivePids: [101, 104],
    });
    await expect(state.run('/Users/me/project')).rejects.toThrow();
    expect(state.alive.has(104)).toBe(true);
    expect(state.nativeDelivery.recoverStoppedRole).not.toHaveBeenCalled();
  });
});
