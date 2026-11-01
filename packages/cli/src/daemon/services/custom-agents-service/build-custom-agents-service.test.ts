import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FunctionArgs } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCustomAgentsService } from './build-custom-agents-service.js';
import type { api } from '../../../api.js';
import type { ConvexClient } from '../../entry/daemon-types.js';

type SyncArgs = FunctionArgs<typeof api.customAgents.syncDefinitions>;

function createFakeConvex() {
  const calls: SyncArgs[] = [];
  const client = {
    mutation: async (_endpoint: unknown, args: SyncArgs) => {
      calls.push(args);
      return { applied: true, rejected: [] };
    },
  } as unknown as ConvexClient;
  return { calls, client };
}

function createFakeMembership() {
  let handler: ((dirs: readonly string[]) => void) | null = null;
  return {
    source: {
      subscribe: (fn: (dirs: readonly string[]) => void) => {
        handler = fn;
        return () => {
          handler = null;
        };
      },
    },
    emit: (dirs: readonly string[]) => handler?.(dirs),
  };
}

async function writeAgent(root: string, name: string): Promise<void> {
  const dir = join(root, '.chatroom', 'agents', name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'AGENT.md'),
    `---\nname: ${name}\ndescription: ${name} role.\n---\nYou are ${name}.\n`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('buildCustomAgentsService', () => {
  let dir: string;
  let homeDir: string;

  beforeEach(async () => {
    // The loader and the disable store do real file I/O, so these tests use real
    // timers and wait for the debounce instead of advancing a fake clock.
    vi.useRealTimers();
    dir = await mkdtemp(join(tmpdir(), 'build-custom-agents-'));
    homeDir = join(dir, 'home');
    await mkdir(homeDir, { recursive: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  it('does not push until the service starts', async () => {
    const convex = createFakeConvex();
    const membership = createFakeMembership();
    const built = buildCustomAgentsService({
      membership: membership.source,
      machineId: 'machine-1',
      sessionId: 'session-1',
      convex: convex.client,
      log: () => undefined,
      homeDir,
    });

    await sleep(700);
    expect(convex.calls).toHaveLength(0);

    built.service.start();
    await vi.waitFor(() => expect(convex.calls).toHaveLength(1), { timeout: 5_000 });

    expect(convex.calls[0]?.scope).toBe('machine');
    built.stopPoll();
    await built.service.stopAll();
  });

  it('pushes the loaded workspace snapshot with the session and machine identity', async () => {
    const workspace = join(dir, 'workspace');
    await writeAgent(workspace, 'alpha');
    const convex = createFakeConvex();
    const membership = createFakeMembership();
    const built = buildCustomAgentsService({
      membership: membership.source,
      machineId: 'machine-1',
      sessionId: 'session-1',
      convex: convex.client,
      log: () => undefined,
      homeDir,
    });

    built.service.start();
    membership.emit([workspace]);
    await vi.waitFor(
      () => expect(convex.calls.some((call) => call.scope === 'workspace')).toBe(true),
      { timeout: 5_000 }
    );

    const workspaceCall = convex.calls.find((call) => call.scope === 'workspace');
    expect(workspaceCall?.sessionId).toBe('session-1');
    expect(workspaceCall?.machineId).toBe('machine-1');
    expect(workspaceCall?.workingDir).toBe(workspace);
    expect(workspaceCall?.agents.map((agent) => agent.name)).toEqual(['alpha']);
    expect(workspaceCall?.agents[0]?.disabled).toBe(false);
    expect(workspaceCall?.issues).toEqual([]);
    expect(workspaceCall?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // Shape the backend `syncDefinitions` args require.
    expect(Object.keys(workspaceCall ?? {}).sort()).toEqual([
      'agents',
      'contentHash',
      'issues',
      'machineId',
      'scope',
      'sessionId',
      'workingDir',
    ]);
    expect(Object.keys(workspaceCall?.agents[0] ?? {}).sort()).toEqual([
      'contentHash',
      'description',
      'disabled',
      'name',
      'systemPrompt',
    ]);

    built.stopPoll();
    await built.service.stopAll();
  });

  it('polls every 60 seconds and stops when the poll is stopped', async () => {
    // The interval is created by the factory, so the clock must be faked first.
    vi.useFakeTimers();
    const convex = createFakeConvex();
    const membership = createFakeMembership();
    const built = buildCustomAgentsService({
      membership: membership.source,
      machineId: 'machine-1',
      sessionId: 'session-1',
      convex: convex.client,
      log: () => undefined,
      homeDir,
    });
    const refresh = vi.spyOn(built.service, 'refresh');

    built.service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledWith('poll');
    expect(refresh).toHaveBeenCalledTimes(1);

    built.stopPoll();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    await built.service.stopAll();
  });
});
