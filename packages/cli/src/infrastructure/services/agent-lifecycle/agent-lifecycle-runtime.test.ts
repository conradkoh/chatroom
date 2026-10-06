import { AgentStartReasonCode } from '@workspace/backend/src/domain/entities/agent.js';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { AgentLifecyclePortAdapterDeps } from './agent-lifecycle-port-adapters.js';
import { createAgentLifecycleRuntime } from './agent-lifecycle-runtime.js';
import { AgentLifecycleService } from './agent-lifecycle-types.js';
import type { RemoteAgentService } from '../../../daemon/infrastructure/local/harness/services/remote-agent-service.js';

function createDeps(): AgentLifecyclePortAdapterDeps {
  const harness: RemoteAgentService = {
    id: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    isInstalled: async () => true,
    getVersion: async () => null,
    listModels: async () => [],
    spawn: vi.fn(async () => ({
      pid: 9876,
      onExit: () => undefined,
      onOutput: () => undefined,
      harnessSessionId: 'runtime-test-session',
    })),
    stop: vi.fn(async () => undefined),
    isAlive: () => true,
    getTrackedProcesses: () => [],
    untrack: () => undefined,
  };

  return {
    spawning: { shouldAllowSpawn: () => ({ allowed: true }) },
    agentServices: new Map([['opencode', harness]]),
    sessionId: 'runtime-test-session',
    machineId: 'runtime-test-machine',
    convexUrl: 'http://127.0.0.1:3210',
    onAgentEnd: () => undefined,
  };
}

const ensureRunning = Effect.gen(function* () {
  const service = yield* AgentLifecycleService;
  return yield* service.ensureRunning({
    chatroomId: 'runtime-test-chatroom',
    role: 'builder',
    agentHarness: 'opencode',
    workingDir: '/tmp/runtime-test-workspace',
    reason: AgentStartReasonCode.USER_MANUAL_SPAWN,
    wantResume: false,
  });
});

const getSlot = Effect.gen(function* () {
  const service = yield* AgentLifecycleService;
  return yield* service.getSlot('runtime-test-chatroom', 'builder', '/tmp/runtime-test-workspace');
});

describe('createAgentLifecycleRuntime', () => {
  it('shares its slot store across operations and isolates separate runtimes', async () => {
    const first = createAgentLifecycleRuntime(createDeps());
    const second = createAgentLifecycleRuntime(createDeps());

    try {
      await expect(first.runPromise(ensureRunning)).resolves.toMatchObject({
        success: true,
        pid: 9876,
      });
      await expect(first.runPromise(getSlot)).resolves.toMatchObject({
        state: 'running',
        pid: 9876,
        harnessSessionId: 'runtime-test-session',
      });
      await expect(second.runPromise(getSlot)).resolves.toBeUndefined();
    } finally {
      await first.dispose();
      await second.dispose();
      await first.dispose();
      await second.dispose();
    }
  });
});
