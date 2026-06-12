// fallow-ignore-file unused-file
/**
 * Mock DaemonSessionInit factory for unit tests.
 *
 * Usage:
 *   const init = createMockDaemonSessionInit();
 *   const init = createMockDaemonSessionInit({ sessionId: 'my-session' });
 */

import { createMockDaemonDeps } from './mock-daemon-deps.js';
import { DaemonEventBus } from '../../../../events/daemon/event-bus.js';
import type { DaemonSessionInit } from '../types.js';

/**
 * Creates a minimal DaemonSessionInit for unit tests (flat deps shape).
 */
export function createMockDaemonSessionInit(
  overrides?: Partial<DaemonSessionInit>
): DaemonSessionInit {
  const deps = createMockDaemonDeps();
  return {
    client: {},
    sessionId: 'test-session-id',
    machineId: 'test-machine-id',
    config: null,
    backend: deps.backend,
    fs: deps.fs,
    machine: deps.machine,
    spawning: deps.spawning,
    agentProcessManager: deps.agentProcessManager,
    events: new DaemonEventBus(),
    agentServices: new Map(),
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
    ...overrides,
  };
}
