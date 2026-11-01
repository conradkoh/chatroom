/**
 * Real-filesystem proof that edits reach Convex: a real chokidar watcher over a
 * temp workspace drives real pushes through the service. Every assertion is a
 * bounded `waitFor`, never a fixed sleep.
 */

import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { watch as realWatch } from 'chokidar';
import type { FunctionArgs } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCustomAgentsService } from './build-custom-agents-service.js';
import type { api } from '../../../api.js';
import type { ConvexClient } from '../../entry/daemon-types.js';

type SyncArgs = FunctionArgs<typeof api.customAgents.syncDefinitions>;

function agentFile(systemPrompt: string): string {
  return `---\nname: x\ndescription: X role.\n---\n${systemPrompt}\n`;
}

describe('custom-agent watchers on a real filesystem', () => {
  let dir: string;
  let workspace: string;
  let agentDir: string;
  let convex: { mutation: (endpoint: unknown, args: SyncArgs) => Promise<unknown> };
  let calls: SyncArgs[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'custom-agents-watch-'));
    workspace = join(dir, 'workspace');
    agentDir = join(workspace, '.chatroom', 'agents', 'x');
    await mkdir(join(workspace, '.chatroom', 'agents'), { recursive: true });
    calls = [];
    convex = {
      mutation: async (_endpoint: unknown, args: SyncArgs) => {
        calls.push(args);
        return { applied: true, rejected: [] };
      },
    };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('pushes on create, edit, and delete, and closes every watcher on stop', async () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const watch = ((path: string, options: unknown) => {
      const watcher = realWatch(path, options as never);
      opened.push(path);
      const originalClose = watcher.close.bind(watcher);
      watcher.close = async () => {
        closed.push(path);
        return originalClose();
      };
      return watcher;
    }) as unknown as typeof realWatch;

    // The source supports several subscribers: the factory and the service each add one.
    const handlers: ((dirs: readonly string[]) => void)[] = [];
    const membership = {
      subscribe: (fn: (dirs: readonly string[]) => void) => {
        handlers.push(fn);
        return () => {
          handlers.splice(handlers.indexOf(fn), 1);
        };
      },
    };
    const emit = (dirs: readonly string[]): void => {
      for (const handler of [...handlers]) handler(dirs);
    };
    const built = buildCustomAgentsService({
      membership,
      machineId: 'machine-watch',
      sessionId: 'session-watch',
      convex: convex as unknown as ConvexClient,
      log: () => undefined,
      homeDir: join(dir, 'home'),
      statePath: join(dir, 'state.json'),
      watch,
    });
    const workspacePushes = () => calls.filter((call) => call.scope === 'workspace');

    built.service.start();
    emit([workspace]);
    await vi.waitFor(() => expect(opened).toContain(join(workspace, '.chatroom', 'agents')), {
      timeout: 5_000,
    });

    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'AGENT.md'), agentFile('You are x.'), 'utf8');
    await vi.waitFor(
      () =>
        expect(
          workspacePushes().some((call) => call.agents.some((agent) => agent.name === 'x'))
        ).toBe(true),
      { timeout: 5_000 }
    );
    const created = workspacePushes().at(-1);
    const createdAgent = created?.agents.find((agent) => agent.name === 'x');
    expect(createdAgent?.systemPrompt).toBe('You are x.');

    // A second push proves the watcher noticed the edit, not the poll.
    await writeFile(join(agentDir, 'AGENT.md'), agentFile('You are x, revised.'), 'utf8');
    await vi.waitFor(
      () =>
        expect(
          workspacePushes().some(
            (call) =>
              call.agents.find((agent) => agent.name === 'x')?.systemPrompt ===
              'You are x, revised.'
          )
        ).toBe(true),
      { timeout: 5_000 }
    );
    const edited = workspacePushes().at(-1);
    expect(edited?.agents.find((agent) => agent.name === 'x')?.contentHash).not.toBe(
      createdAgent?.contentHash
    );

    await unlink(join(agentDir, 'AGENT.md'));
    await rm(agentDir, { recursive: true, force: true });
    await vi.waitFor(
      () =>
        expect(
          workspacePushes().some((call) => call.agents.every((agent) => agent.name !== 'x'))
        ).toBe(true),
      { timeout: 5_000 }
    );

    built.stopPoll();
    await vi.waitFor(() => expect(closed.length).toBe(opened.length), { timeout: 5_000 });
    expect(closed).toContain(join(workspace, '.chatroom', 'agents'));
    await built.service.stopAll();
  });
});
