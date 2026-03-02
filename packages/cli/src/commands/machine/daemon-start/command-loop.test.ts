/**
 * command-loop Unit Tests
 *
 * Tests the refreshModels function using injected dependencies.
 *
 * Note: startCommandLoop is not tested here because it involves
 * WebSocket subscriptions, timers, and signal handlers. The individual
 * event handlers it dispatches to are tested in their own test files.
 * processCommand was removed in Phase D — commands now arrive via event
 * stream and are handled directly in the stream subscription.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshModels } from './command-loop.js';
import type { DaemonDeps } from './deps.js';
import { DaemonEventBus } from '../../../events/daemon/event-bus.js';
import type { DaemonContext, AgentHarness } from './types.js';
import type { RemoteAgentService } from '../../../infrastructure/services/remote-agents/remote-agent-service.js';
import { OpenCodeAgentService } from '../../../infrastructure/services/remote-agents/opencode/index.js';
import { PiAgentService } from '../../../infrastructure/services/remote-agents/pi/index.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://test:3210',
  getConvexWsClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// refreshModels
// ---------------------------------------------------------------------------

describe('refreshModels', () => {
  function createContextWithServices(
    services: Array<{ harness: AgentHarness; isInstalled: boolean; models: string[] | Error }>
  ): DaemonContext {
    const agentServices = new Map<AgentHarness, RemoteAgentService>(
      services.map(({ harness, isInstalled: installed, models }) => [
        harness,
        {
          isInstalled: vi.fn().mockReturnValue(installed),
          listModels:
            models instanceof Error
              ? vi.fn().mockRejectedValue(models)
              : vi.fn().mockResolvedValue(models),
        } as unknown as RemoteAgentService,
      ])
    );

    const deps: DaemonDeps = {
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue(undefined),
      },
      processes: { kill: vi.fn() },
      fs: { stat: vi.fn() as any },
      stops: { mark: vi.fn(), consume: vi.fn().mockReturnValue(false), clear: vi.fn() },
      machine: {
        clearAgentPid: vi.fn(),
        persistAgentPid: vi.fn(),
        listAgentEntries: vi.fn().mockReturnValue([]),
        persistEventCursor: vi.fn(),
        loadEventCursor: vi.fn().mockReturnValue(null),
      },
      clock: { now: vi.fn().mockReturnValue(Date.now()), delay: vi.fn().mockResolvedValue(undefined) },
    };

    return {
      client: {} as any,
      sessionId: 'test-session-id',
      machineId: 'test-machine-id',
      config: {
        machineId: 'test-machine-id',
        hostname: 'test-host',
        os: 'darwin',
        registeredAt: '2026-01-01T00:00:00Z',
        lastSyncedAt: '2026-01-01T00:00:00Z',
        availableHarnesses: ['opencode', 'pi'],
        harnessVersions: {},
      },
      deps,
      events: new DaemonEventBus(),
      agentServices,
    };
  }

  it('discovers models from all installed harnesses', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a', 'opencode/model-b'] },
      { harness: 'pi', isInstalled: true, models: ['github-copilot/claude-sonnet-4.5'] },
    ]);

    await refreshModels(ctx);

    expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        availableModels: {
          opencode: ['opencode/model-a', 'opencode/model-b'],
          pi: ['github-copilot/claude-sonnet-4.5'],
        },
      })
    );
  });

  it('skips harnesses that are not installed — does not write empty entry', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a'] },
      { harness: 'pi', isInstalled: false, models: [] },
    ]);

    await refreshModels(ctx);

    expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        availableModels: {
          opencode: ['opencode/model-a'],
          // pi must NOT be present — was not installed
        },
      })
    );
    const call = vi.mocked(ctx.deps.backend.mutation).mock.calls[0][1] as any;
    expect(call.availableModels).not.toHaveProperty('pi');
  });

  it('skips harness entry when listModels throws (non-critical error)', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: new Error('opencode broke') },
      { harness: 'pi', isInstalled: true, models: ['github-copilot/gpt-4o'] },
    ]);

    await refreshModels(ctx);

    const call = vi.mocked(ctx.deps.backend.mutation).mock.calls[0][1] as any;
    // opencode failed so it should be absent; pi succeeded
    expect(call.availableModels).not.toHaveProperty('opencode');
    expect(call.availableModels).toEqual({ pi: ['github-copilot/gpt-4o'] });
  });

  it('does not call mutation when config is null', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a'] },
    ]);
    ctx.config = null;

    await refreshModels(ctx);

    expect(ctx.deps.backend.mutation).not.toHaveBeenCalled();
  });

  it('warns but does not throw when mutation fails', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a'] },
    ]);
    vi.mocked(ctx.deps.backend.mutation).mockRejectedValueOnce(new Error('network error'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(refreshModels(ctx)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Model refresh failed'));
  });
});
