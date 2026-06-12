// fallow-ignore-file unused-file
/**
 * Mock DaemonContext factory for unit tests.
 *
 * Provides a minimal DaemonContext with all fields defaulted to sensible test
 * values. Use overrides to customise specific fields per test.
 *
 * Usage:
 *   const ctx = createMockDaemonContext();
 *   const ctx = createMockDaemonContext({ machineId: 'my-machine' });
 */

import { createMockDaemonDeps } from './mock-daemon-deps.js';
import { DaemonEventBus } from '../../../../events/daemon/event-bus.js';
import type { DaemonContext } from '../types.js';

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
