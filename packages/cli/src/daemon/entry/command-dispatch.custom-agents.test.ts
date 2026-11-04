/**
 * Custom-agent machine commands: payload forwarding, dedup, failure isolation,
 * and one end-to-end run that starts the real service wiring, registers a
 * workspace, and applies a dispatched disable command.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FunctionArgs } from 'convex/server';
import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDedupTracker,
  dispatchCommandEventEffect,
  type DedupTracker,
} from './command-dispatch.js';
import {
  DaemonAgentProcessManagerCommandService,
  DaemonAgentProcessManagerService,
  DaemonMutableStateService,
  DaemonSessionService,
} from './daemon-services.js';
import type { ConvexClient } from './daemon-types.js';
import type { api } from '../../api.js';
import { buildCustomAgentsService } from '../services/custom-agents-service/build-custom-agents-service.js';

type SyncArgs = FunctionArgs<typeof api.customAgents.syncDefinitions>;

function setDisabledEvent(id: string, name: string, disabled: boolean) {
  return {
    _id: id,
    machineId: 'machine-1',
    deadline: 0,
    timestamp: 0,
    type: 'daemon.customAgentsSetDisabled',
    name,
    disabled,
  };
}

function refreshEvent(id: string) {
  return {
    _id: id,
    machineId: 'machine-1',
    deadline: 0,
    timestamp: 0,
    type: 'daemon.customAgentsRefresh',
  };
}

function createFakeService() {
  return {
    setDisabled: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
  };
}

async function dispatch(
  event: Record<string, unknown>,
  tracker: DedupTracker,
  service: ReturnType<typeof createFakeService> | null
): Promise<void> {
  const layer = Layer.mergeAll(
    Layer.succeed(DaemonSessionService, { customAgentsService: service } as never),
    Layer.succeed(DaemonAgentProcessManagerService, {} as never),
    Layer.succeed(DaemonAgentProcessManagerCommandService, {} as never),
    Layer.succeed(DaemonMutableStateService, {} as never)
  );
  await Effect.runPromise(
    dispatchCommandEventEffect(event as never, tracker, {} as never).pipe(Effect.provide(layer))
  );
}

describe('custom-agent command handlers', () => {
  it('forwards daemon.customAgentsSetDisabled with the exact payload', async () => {
    const service = createFakeService();
    const tracker = createDedupTracker();

    await dispatch(setDisabledEvent('cmd-1', 'alpha', true), tracker, service);

    expect(service.setDisabled).toHaveBeenCalledWith('alpha', true);
    expect(tracker.customAgentsIds.has('cmd-1')).toBe(true);
  });

  it('forwards daemon.customAgentsRefresh as a command refresh', async () => {
    const service = createFakeService();
    const tracker = createDedupTracker();

    await dispatch(refreshEvent('cmd-2'), tracker, service);

    expect(service.refresh).toHaveBeenCalledWith('command');
    expect(tracker.customAgentsIds.has('cmd-2')).toBe(true);
  });

  it('deduplicates a redelivered event id', async () => {
    const service = createFakeService();
    const tracker = createDedupTracker();
    const event = setDisabledEvent('cmd-3', 'alpha', false);

    await dispatch(event, tracker, service);
    await dispatch(event, tracker, service);

    expect(service.setDisabled).toHaveBeenCalledTimes(1);
  });

  it('logs a service failure and does not throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = createFakeService();
    service.setDisabled.mockRejectedValue(new Error('store write failed'));

    await expect(
      dispatch(setDisabledEvent('cmd-4', 'alpha', true), createDedupTracker(), service)
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('store write failed'));
    warn.mockRestore();
  });

  it('does nothing when the service is absent', async () => {
    await expect(
      dispatch(setDisabledEvent('cmd-5', 'alpha', true), createDedupTracker(), null)
    ).resolves.toBeUndefined();
  });
});

describe('custom-agent command end to end', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'custom-agents-e2e-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('pushes a registered workspace, then re-pushes with the dispatched disable', async () => {
    const workspace = join(dir, 'workspace');
    const agentDir = join(workspace, '.chatroom', 'agents', 'x');
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, 'AGENT.md'),
      '---\nname: x\ndescription: X role.\n---\nYou are x.\n'
    );

    const calls: SyncArgs[] = [];
    const convex = {
      mutation: async (_endpoint: unknown, args: SyncArgs) => {
        calls.push(args);
        return { applied: true, rejected: [] };
      },
    } as unknown as ConvexClient;
    let handler = (_dirs: readonly string[]): void => undefined;
    const membership = {
      subscribe: (fn: (dirs: readonly string[]) => void) => {
        handler = fn;
        return () => {
          handler = () => undefined;
        };
      },
    };

    const built = buildCustomAgentsService({
      membership,
      machineId: 'machine-e2e',
      sessionId: 'session-e2e',
      convex,
      log: () => undefined,
      homeDir: join(dir, 'home'),
      statePath: join(dir, 'custom-agents-disabled.json'),
    });
    const workspacePushes = () => calls.filter((call) => call.scope === 'workspace');

    built.service.start();
    handler([workspace]);
    await vi.waitFor(() => expect(workspacePushes()).toHaveLength(1), { timeout: 5_000 });
    expect(workspacePushes()[0]?.workingDir).toBe(workspace);
    expect(workspacePushes()[0]?.agents.map((agent) => agent.name)).toEqual(['x']);
    expect(workspacePushes()[0]?.agents[0]?.disabled).toBe(false);

    await dispatch(
      setDisabledEvent('cmd-e2e', 'x', true),
      createDedupTracker(),
      built.service as never
    );

    await vi.waitFor(() => expect(workspacePushes()).toHaveLength(2), { timeout: 5_000 });
    expect(workspacePushes()[1]?.agents[0]?.disabled).toBe(true);

    built.stopPoll();
    await built.service.stopAll();
  });
});
