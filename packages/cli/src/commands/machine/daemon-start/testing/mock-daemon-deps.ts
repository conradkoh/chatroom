/**
 * Shared test mock factory for DaemonDeps.
 *
 * Provides a single source of truth for DaemonDeps mocks across all
 * daemon-related test files. When a new dep is added to DaemonDeps,
 * only this file needs to be updated.
 *
 * Usage:
 *   const deps = createMockDaemonDeps();
 *
 * Override specific fields:
 *   const deps = createMockDaemonDeps({
 *     backend: { mutation: myCustomMock, query: vi.fn().mockResolvedValue({ configs: [] }) },
 *   });
 */

import { vi } from 'vitest';

import type { DaemonDeps } from '../deps.js';

/**
 * Creates a fully-mocked DaemonDeps object suitable for unit tests.
 * All methods are vi.fn() mocks with sensible defaults.
 *
 * @param overrides - Partial DaemonDeps to shallow-merge over the defaults.
 *   Use this to override entire sub-objects (e.g., `backend`).
 *   Individual method overrides should be done by mutating the returned object.
 */
export function createMockDaemonDeps(overrides?: Partial<DaemonDeps>): DaemonDeps {
  const defaults: DaemonDeps = {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ configs: [] }),
    },
    processes: {
      kill: vi.fn(),
    },
    fs: {
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    },
    machine: {
      clearAgentPid: vi.fn(),
      persistAgentPid: vi.fn(),
      listAgentEntries: vi.fn().mockReturnValue([]),
      persistEventCursor: vi.fn(),
      loadEventCursor: vi.fn().mockReturnValue(null),
    },
    clock: {
      now: vi.fn().mockReturnValue(Date.now()),
      delay: vi.fn().mockResolvedValue(undefined),
    },
    spawning: {
      shouldAllowSpawn: vi.fn().mockReturnValue({ allowed: true }),
      recordSpawn: vi.fn(),
      recordExit: vi.fn(),
      getConcurrentCount: vi.fn().mockReturnValue(0),
    },
  };

  return {
    ...defaults,
    ...overrides,
  };
}
