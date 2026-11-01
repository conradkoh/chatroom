import type { watch as chokidarWatch } from 'chokidar';
import { describe, expect, it, vi } from 'vitest';

import { createCustomAgentWatchers } from './custom-agent-watchers.js';

type Handler = (arg?: unknown) => void;

class FakeWatcher {
  readonly handlers = new Map<string, Handler[]>();
  closes = 0;

  on(event: string, handler: Handler): this {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
    return this;
  }

  emit(event: string, arg?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(arg);
  }

  async close(): Promise<void> {
    this.closes += 1;
  }
}

function createHarness(existing: readonly string[]) {
  const watchers = new Map<string, FakeWatcher>();
  const calls: { path: string; options: unknown }[] = [];
  const onChange = vi.fn();
  const log = vi.fn();
  const watch = ((path: string, options: unknown) => {
    const watcher = new FakeWatcher();
    watchers.set(path, watcher);
    calls.push({ path, options });
    return watcher;
  }) as unknown as typeof chokidarWatch;

  const subject = createCustomAgentWatchers({
    onChange,
    log,
    watch,
    existsSync: (path) => existing.includes(path),
  });
  return { subject, watchers, calls, onChange, log };
}

describe('createCustomAgentWatchers', () => {
  it('does not watch a root that does not exist', () => {
    const harness = createHarness([]);

    harness.subject.syncRoots(['/ws/a/.chatroom/agents']);

    expect(harness.calls).toHaveLength(0);
  });

  it('watches an existing root with the documented options', () => {
    const harness = createHarness(['/ws/a/.chatroom/agents']);

    harness.subject.syncRoots(['/ws/a/.chatroom/agents']);

    expect(harness.calls).toEqual([
      {
        path: '/ws/a/.chatroom/agents',
        options: {
          depth: 2,
          followSymlinks: false,
          ignoreInitial: true,
          ignorePermissionErrors: true,
          awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        },
      },
    ]);
  });

  it('closes a watcher for a root that is no longer wanted', () => {
    const harness = createHarness(['/ws/a/.chatroom/agents', '/ws/b/.chatroom/agents']);
    harness.subject.syncRoots(['/ws/a/.chatroom/agents', '/ws/b/.chatroom/agents']);

    harness.subject.syncRoots(['/ws/a/.chatroom/agents']);

    expect(harness.watchers.get('/ws/a/.chatroom/agents')?.closes).toBe(0);
    expect(harness.watchers.get('/ws/b/.chatroom/agents')?.closes).toBe(1);
  });

  it('does not attach a second watcher for a root it already watches', () => {
    const harness = createHarness(['/ws/a/.chatroom/agents']);

    harness.subject.syncRoots(['/ws/a/.chatroom/agents']);
    harness.subject.syncRoots(['/ws/a/.chatroom/agents']);

    expect(harness.calls).toHaveLength(1);
  });

  it('closeAll closes every watcher', async () => {
    const harness = createHarness(['/ws/a/.chatroom/agents', '/ws/b/.chatroom/agents']);
    harness.subject.syncRoots(['/ws/a/.chatroom/agents', '/ws/b/.chatroom/agents']);

    await harness.subject.closeAll();

    expect(harness.watchers.get('/ws/a/.chatroom/agents')?.closes).toBe(1);
    expect(harness.watchers.get('/ws/b/.chatroom/agents')?.closes).toBe(1);
  });

  it('ignores syncRoots after closeAll', async () => {
    const harness = createHarness(['/ws/a/.chatroom/agents']);
    await harness.subject.closeAll();

    harness.subject.syncRoots(['/ws/a/.chatroom/agents']);

    expect(harness.calls).toHaveLength(0);
  });

  it('logs the first watcher error only and never throws', () => {
    const harness = createHarness(['/ws/a/.chatroom/agents']);
    harness.subject.syncRoots(['/ws/a/.chatroom/agents']);
    const watcher = harness.watchers.get('/ws/a/.chatroom/agents');

    expect(() => {
      watcher?.emit('error', new Error('EMFILE'));
      watcher?.emit('error', new Error('EMFILE'));
    }).not.toThrow();

    expect(harness.log).toHaveBeenCalledTimes(1);
    expect(harness.log.mock.calls[0]?.[0]).toContain('EMFILE');
  });

  it.each(['add', 'change', 'unlink', 'addDir', 'unlinkDir'])(
    'signals a refresh on %s',
    (event) => {
      const harness = createHarness(['/ws/a/.chatroom/agents']);
      harness.subject.syncRoots(['/ws/a/.chatroom/agents']);

      harness.watchers.get('/ws/a/.chatroom/agents')?.emit(event, 'x/AGENT.md');

      expect(harness.onChange).toHaveBeenCalledTimes(1);
    }
  );
});
