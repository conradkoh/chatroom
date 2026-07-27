import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { ProcessManager } from './process-manager.js';

const MINIMAL_CONFIG = {
  webappPort: 3000,
  convexBackendMode: 'local' as const,
  convexPort: 3210,
  convexUrl: '',
};

describe('ProcessManager log clearing', () => {
  let repoRoot: string;

  beforeAll(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'pm-test-'));
  });

  afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('clears only the restarted process logs on webapp restart', async () => {
    const manager = new ProcessManager(repoRoot, 3847);
    (manager as any)._runtimeConfig = MINIMAL_CONFIG;
    const cleared: string[] = [];
    manager.on('logs-clear', (id) => cleared.push(id));

    await manager.restart('webapp');

    expect(cleared).toEqual(['webapp']);
  });

  it('restart convex does not clear webapp or daemon logs', async () => {
    const manager = new ProcessManager(repoRoot, 3847);
    (manager as any)._runtimeConfig = MINIMAL_CONFIG;
    (manager as any).start = vi.fn();
    (manager as any).monitorConvexReadiness = vi.fn().mockResolvedValue('healthy');
    const cleared: string[] = [];
    manager.on('logs-clear', (id) => cleared.push(id));

    await manager.restart('convex');

    expect(cleared).toEqual(['convex']);
    const processes = manager.getProcesses();
    expect(processes.find((p) => p.id === 'webapp')?.status).toBe('stopped');
    expect(processes.find((p) => p.id === 'daemon')?.status).toBe('stopped');
  });
});
