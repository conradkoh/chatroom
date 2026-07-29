import { mkdtempSync, rmSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';
import { ProcessManager } from './process-manager.js';

describe('stale process exit handler', () => {
  let repoRoot: string;

  beforeAll(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'pm-stale-'));
  });

  afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('ignores exit event from a replaced child process', () => {
    const convexDef = {
      id: 'convex' as const,
      command: 'node',
      args: ['dummy.js'],
      cwd: repoRoot,
      env: {},
      shell: false,
    };

    const firstExitCallbacks: Array<(code: number | null) => void> = [];
    const firstChild = new EventEmitter() as any;
    firstChild.pid = 100;
    firstChild.kill = vi.fn();
    firstChild.stdout = new EventEmitter();
    firstChild.stderr = new EventEmitter();
    firstChild.stdout.on = vi.fn();
    firstChild.stderr.on = vi.fn();
    firstChild.on = vi.fn((event: string, cb: any) => {
      if (event === 'exit') firstExitCallbacks.push(cb);
      return firstChild;
    });

    const secondChild = new EventEmitter() as any;
    secondChild.pid = 200;
    secondChild.kill = vi.fn();
    secondChild.stdout = new EventEmitter();
    secondChild.stderr = new EventEmitter();
    secondChild.stdout.on = vi.fn();
    secondChild.stderr.on = vi.fn();
    secondChild.on = vi.fn();

    let callCount = 0;
    (spawn as any).mockImplementation(() => {
      callCount++;
      return callCount === 1 ? firstChild : secondChild;
    });

    const manager = new ProcessManager(repoRoot, 3847);

    (manager as any).start(convexDef);
    expect(manager.getProcesses().find((p: any) => p.id === 'convex')?.status).toBe('running');

    (manager as any).stop('convex');
    expect(manager.getProcesses().find((p: any) => p.id === 'convex')?.status).toBe('stopped');

    (manager as any).start(convexDef);
    expect(manager.getProcesses().find((p: any) => p.id === 'convex')?.status).toBe('running');

    for (const cb of firstExitCallbacks) {
      cb(0);
    }

    const convexState = manager.getProcesses().find((p: any) => p.id === 'convex');
    expect(convexState?.status).toBe('running');
  });
});
