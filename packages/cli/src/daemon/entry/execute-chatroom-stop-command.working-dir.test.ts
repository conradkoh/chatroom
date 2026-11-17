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
import { buildStopTargetDescriptor } from '../services/agent-process-service/infrastructure/stop-agent-confirmed-adapter.js';

const ROOM = 'room-1';
const SLOT_WORKING_DIR = '/Users/me/project/';
const WORKSPACE_WORKING_DIR = '/Users/me/project';

function setup() {
  const alive = new Set<number>([101, 102]);
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
  const lifecycleEnqueue = vi.fn(async () => ({ success: true }));
  const targets = [
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
    harnessService,
    lifecycleEnqueue,
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
});
