/**
 * state-recovery handler Unit Tests
 *
 * Tests recoverAgentState — delegates to AgentProcessManager.recover()
 * and registers workspaces via backend mutations.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DaemonEventBus } from '../../../../events/daemon/event-bus.js';
import { OpenCodeAgentService } from '../../../../infrastructure/services/remote-agents/opencode/index.js';
import type { DaemonDeps } from '../deps.js';
import type { DaemonContext } from '../types.js';
import { recoverAgentState } from './state-recovery.js';
import { createMockDaemonDeps } from '../testing/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext(overrides?: {
  activeSlots?: Array<{ chatroomId: string; role: string; slot: any }>;
  configs?: Array<{ machineId: string; workingDir?: string; role?: string }>;
}): DaemonContext {
  const deps: DaemonDeps = createMockDaemonDeps();

  // Configure agentProcessManager mock
  vi.mocked(deps.agentProcessManager.listActive).mockReturnValue(overrides?.activeSlots ?? []);

  // Configure backend query for getMachineAgentConfigs
  if (overrides?.configs) {
    vi.mocked(deps.backend.query).mockResolvedValue({ configs: overrides.configs });
  }

  return {
    client: {},
    sessionId: 'test-session-id',
    machineId: 'test-machine-id',
    config: null,
    deps,
    events: new DaemonEventBus(),
    agentServices: new Map([
      [
        'opencode',
        new OpenCodeAgentService({
          execSync: vi.fn(),
          spawn: vi.fn() as any,
          kill: vi.fn(),
        }),
      ],
    ]),
    lastPushedGitState: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recoverAgentState', () => {
  it('delegates to agentProcessManager.recover()', async () => {
    const ctx = createMockContext();

    await recoverAgentState(ctx);

    expect(ctx.deps.agentProcessManager.recover).toHaveBeenCalledOnce();
  });

  it('registers workspaces for active agents via backend mutation', async () => {
    const ctx = createMockContext({
      activeSlots: [
        { chatroomId: 'room-1', role: 'builder', slot: { state: 'running', pid: 100 } },
      ],
      configs: [{ machineId: 'test-machine-id', workingDir: '/tmp/workspace', role: 'builder' }],
    });

    await recoverAgentState(ctx);

    expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(), // api.workspaces.registerWorkspace
      expect.objectContaining({
        sessionId: 'test-session-id',
        chatroomId: 'room-1',
        machineId: 'test-machine-id',
        workingDir: '/tmp/workspace',
        registeredBy: 'builder',
      })
    );
  });

  it('skips working dirs from other machines (no registerWorkspace called)', async () => {
    const ctx = createMockContext({
      activeSlots: [
        { chatroomId: 'room-1', role: 'builder', slot: { state: 'running', pid: 100 } },
      ],
      configs: [{ machineId: 'other-machine', workingDir: '/tmp/other' }],
    });

    await recoverAgentState(ctx);

    // mutation should not have been called for workspace registration
    expect(ctx.deps.backend.mutation).not.toHaveBeenCalled();
  });

  it('handles no active agents after recovery', async () => {
    const ctx = createMockContext({ activeSlots: [] });

    await recoverAgentState(ctx);

    expect(ctx.deps.agentProcessManager.recover).toHaveBeenCalledOnce();
    // No mutations should be called when there are no active agents
    expect(ctx.deps.backend.mutation).not.toHaveBeenCalled();
  });
});
