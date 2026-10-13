import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceStateUnit } from './workspace-state-outbox-schema.js';
import { encodeWorkspaceStateKey, type WorkspaceStateKind } from './workspace-state-outbox.js';
import { createWorkspaceStateSend } from './workspace-state-send.js';
import { api } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';

const SESSION = { sessionId: 'session-1', machineId: 'machine-1' };
const HEAD: WorkspaceStateUnit = { kind: 'head', status: 'available', branch: 'main' };
const WORKTREE: WorkspaceStateUnit = {
  kind: 'worktree',
  isDirty: false,
  diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
};

function fakeBackend(
  mutation: (endpoint: unknown, args: unknown) => Promise<unknown> = async () => ({ applied: true })
) {
  const fn = vi.fn(mutation);
  const backend: BackendOps = { mutation: fn, query: vi.fn() };
  return { backend, mutation: fn };
}

function keyFor(workingDir: string, kind: WorkspaceStateKind): string {
  return encodeWorkspaceStateKey(workingDir, kind);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Lets queued microtasks and zero-delay timers run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createWorkspaceStateSend', () => {
  it.each([
    {
      name: 'git-state units go to patchWorkspaceGitState with the unit',
      unit: HEAD,
      endpoint: api.workspaces.patchWorkspaceGitState,
      args: { unit: HEAD },
      result: { applied: true },
    },
    {
      name: 'recentCommits go to upsertRecentCommits',
      unit: {
        kind: 'recentCommits',
        commits: [{ sha: 'abc', shortSha: 'abc', message: 'm', author: 'a', date: 'd' }],
        hasMoreCommits: true,
      } satisfies WorkspaceStateUnit,
      endpoint: api.workspaces.upsertRecentCommits,
      args: {
        commits: [{ sha: 'abc', shortSha: 'abc', message: 'm', author: 'a', date: 'd' }],
        hasMoreCommits: true,
      },
      result: { applied: true },
    },
    {
      name: 'commands go to syncCommands',
      unit: {
        kind: 'commands',
        commands: [{ name: 'build', script: 'tsc', source: 'package.json' }],
      } satisfies WorkspaceStateUnit,
      endpoint: api.commands.syncCommands,
      args: { commands: [{ name: 'build', script: 'tsc', source: 'package.json' }] },
      result: { applied: true },
    },
  ])('maps $name', async ({ unit, endpoint, args, result }) => {
    const { backend, mutation } = fakeBackend();
    const send = createWorkspaceStateSend({ ...SESSION, backend });

    await expect(send(keyFor('/workspace', unit.kind))(unit)).resolves.toEqual(result);

    expect(mutation).toHaveBeenCalledExactlyOnceWith(endpoint, {
      sessionId: 'session-1',
      machineId: 'machine-1',
      workingDir: '/workspace',
      ...args,
    });
  });

  it('passes the applied flag from patchWorkspaceGitState through unchanged', async () => {
    const { backend } = fakeBackend(async () => ({ applied: false, reason: 'unchanged' }));
    const send = createWorkspaceStateSend({ ...SESSION, backend });

    await expect(send(keyFor('/workspace', 'worktree'))(WORKTREE)).resolves.toEqual({
      applied: false,
    });
  });

  it('serializes deliveries for one working directory in enqueue order', async () => {
    const started: string[] = [];
    const gates: ReturnType<typeof deferred<{ applied: boolean }>>[] = [];
    const { backend } = fakeBackend(async (_endpoint, args) => {
      started.push((args as { unit: WorkspaceStateUnit }).unit.kind);
      const gate = deferred<{ applied: boolean }>();
      gates.push(gate);
      return gate.promise;
    });
    const send = createWorkspaceStateSend({ ...SESSION, backend });

    const first = send(keyFor('/a', 'head'))(HEAD);
    const second = send(keyFor('/a', 'worktree'))(WORKTREE);
    await settle();
    expect(started).toEqual(['head']);

    gates[0]!.resolve({ applied: true });
    await first;
    await settle();
    expect(started).toEqual(['head', 'worktree']);

    gates[1]!.resolve({ applied: true });
    await expect(second).resolves.toEqual({ applied: true });
  });

  it('runs different working directories concurrently', async () => {
    const started: string[] = [];
    const gates: ReturnType<typeof deferred<{ applied: boolean }>>[] = [];
    const { backend } = fakeBackend(async (_endpoint, args) => {
      started.push((args as { workingDir: string }).workingDir);
      const gate = deferred<{ applied: boolean }>();
      gates.push(gate);
      return gate.promise;
    });
    const send = createWorkspaceStateSend({ ...SESSION, backend });

    const a = send(keyFor('/a', 'head'))(HEAD);
    const b = send(keyFor('/b', 'head'))(HEAD);
    await settle();
    expect(started).toEqual(['/a', '/b']);

    gates.forEach((gate) => gate.resolve({ applied: true }));
    await expect(Promise.all([a, b])).resolves.toEqual([{ applied: true }, { applied: true }]);
  });

  it('does not let a failed delivery block later deliveries for the same working directory', async () => {
    const { backend, mutation } = fakeBackend();
    mutation.mockRejectedValueOnce(new Error('boom'));
    const send = createWorkspaceStateSend({ ...SESSION, backend });

    const first = send(keyFor('/a', 'head'))(HEAD);
    const second = send(keyFor('/a', 'worktree'))(WORKTREE);

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toEqual({ applied: true });
  });
});
