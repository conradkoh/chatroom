import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { ProcessManager } from './process-manager.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ProcessManager log clearing', () => {
  let repoRoot: string;

  beforeAll(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'pm-test-'));
  });

  afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('emits logs-clear for all processes on restart', async () => {
    const manager = new ProcessManager(repoRoot, 3847);
    const cleared: string[] = [];
    manager.on('logs-clear', (id) => cleared.push(id));

    await manager.restart('webapp');

    expect(cleared).toEqual(['convex', 'webapp', 'daemon']);
  });
});
