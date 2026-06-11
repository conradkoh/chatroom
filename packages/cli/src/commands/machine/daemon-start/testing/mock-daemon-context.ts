// fallow-ignore-file unused-file
/**
 * Mock factories for unit tests.
 *
 * Provides minimal DaemonContext and DaemonSessionInit factories with all
 * fields defaulted to sensible test values. Use overrides to customise
 * specific fields per test.
 *
 * Usage:
 *   const ctx = createMockDaemonContext();
 *   const init = createMockDaemonSessionInit({ sessionId: 'my-session' });
 */

import { createMockDaemonDeps } from './mock-daemon-deps.js';
import { DaemonEventBus } from '../../../../events/daemon/event-bus.js';
import type { DaemonContext, DaemonSessionInit } from '../types.js';

export function createMockDaemonContext(overrides?: Partial<DaemonContext>): DaemonContext {
  return {
    client: {},
    sessionId: 'test-session-id',
    machineId: 'test-machine-id',
    config: null,
    deps: createMockDaemonDeps(),
    events: new DaemonEventBus(),
    agentServices: new Map(),
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
    ...overrides,
  };
}

/**
 * Creates a minimal DaemonSessionInit for unit tests (flat deps shape).
 * Prefer this over createMockDaemonContext for new tests.
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
