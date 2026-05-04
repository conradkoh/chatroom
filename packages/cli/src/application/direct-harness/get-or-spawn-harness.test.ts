import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HarnessProcessRegistry } from './get-or-spawn-harness.js';
import type { HarnessProcess } from './get-or-spawn-harness.js';
import type { DirectHarnessSpawner } from '../../domain/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockSpawner(): DirectHarnessSpawner {
  return {
    harnessName: 'test-harness',
    openSession: vi.fn().mockResolvedValue({}),
    resumeSession: vi.fn().mockResolvedValue({}),
  };
}

function createMockProcess(workspaceId: string, alive = true): HarnessProcess {
  let isAlive = alive;
  return {
    workspaceId,
    spawner: createMockSpawner(),
    isAlive: () => isAlive,
    kill: vi.fn().mockImplementation(async () => {
      isAlive = false;
    }),
    listAgents: vi.fn().mockResolvedValue([]),
    listProviders: vi.fn().mockResolvedValue([]),
  };
}

function createRegistry(factoryFn?: (workspaceId: string, cwd: string) => Promise<HarnessProcess>) {
  const factory =
    factoryFn ??
    vi.fn().mockImplementation(async (workspaceId: string) => createMockProcess(workspaceId));
  const registry = new HarnessProcessRegistry(factory as any);
  return { registry, factory: factory as ReturnType<typeof vi.fn> };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('HarnessProcessRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the same process instance for the same workspaceId', async () => {
    const { registry, factory } = createRegistry();

    const p1 = await registry.getOrSpawn('workspace-1', '/tmp/ws1');
    const p2 = await registry.getOrSpawn('workspace-1', '/tmp/ws1');

    expect(p1).toBe(p2);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('spawns a new process for a different workspaceId', async () => {
    const { registry, factory } = createRegistry();

    const p1 = await registry.getOrSpawn('workspace-1', '/tmp/ws1');
    const p2 = await registry.getOrSpawn('workspace-2', '/tmp/ws2');

    expect(p1).not.toBe(p2);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('replaces a failed (dead) process on next getOrSpawn', async () => {
    const { registry, factory } = createRegistry();

    const p1 = await registry.getOrSpawn('workspace-1', '/tmp/ws1');
    // Kill the process to simulate failure
    await p1.kill();
    expect(p1.isAlive()).toBe(false);

    // Next call should spawn a new process
    const p2 = await registry.getOrSpawn('workspace-1', '/tmp/ws1');

    expect(p2).not.toBe(p1);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent getOrSpawn calls for the same workspace', async () => {
    let resolveSpawn!: (p: HarnessProcess) => void;
    const spawnPromise = new Promise<HarnessProcess>((resolve) => {
      resolveSpawn = resolve;
    });

    const factory = vi.fn().mockReturnValue(spawnPromise);
    const registry = new HarnessProcessRegistry(factory);

    // Fire two concurrent spawns
    const promise1 = registry.getOrSpawn('workspace-1', '/tmp/ws1');
    const promise2 = registry.getOrSpawn('workspace-1', '/tmp/ws1');

    // Resolve the factory
    const mockProcess = createMockProcess('workspace-1');
    resolveSpawn(mockProcess);

    const [p1, p2] = await Promise.all([promise1, promise2]);

    expect(p1).toBe(p2); // Same instance
    expect(factory).toHaveBeenCalledTimes(1); // Only one spawn
  });

  it('evicts the pending entry on spawn failure so the next call retries', async () => {
    let callCount = 0;
    const factory = vi.fn().mockImplementation(async (workspaceId: string) => {
      callCount++;
      if (callCount === 1) throw new Error('spawn failed');
      return createMockProcess(workspaceId);
    });

    const registry = new HarnessProcessRegistry(factory);

    await expect(registry.getOrSpawn('workspace-1', '/tmp/ws1')).rejects.toThrow('spawn failed');

    // Second attempt should retry (not return cached error)
    const p = await registry.getOrSpawn('workspace-1', '/tmp/ws1');
    expect(p).toBeDefined();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('killAll() terminates all running processes and clears the registry', async () => {
    const { registry } = createRegistry();

    const p1 = await registry.getOrSpawn('workspace-1', '/tmp/ws1');
    const p2 = await registry.getOrSpawn('workspace-2', '/tmp/ws2');

    await registry.killAll();

    expect(p1.kill).toHaveBeenCalled();
    expect(p2.kill).toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  it('invalidate() removes a specific workspace from the registry', async () => {
    const { registry, factory } = createRegistry();

    await registry.getOrSpawn('workspace-1', '/tmp/ws1');
    registry.invalidate('workspace-1');

    // Next call should spawn a new process
    await registry.getOrSpawn('workspace-1', '/tmp/ws1');

    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('size reflects the number of live tracked processes', async () => {
    const { registry } = createRegistry();

    expect(registry.size).toBe(0);
    await registry.getOrSpawn('workspace-1', '/tmp/ws1');
    expect(registry.size).toBe(1);
    await registry.getOrSpawn('workspace-2', '/tmp/ws2');
    expect(registry.size).toBe(2);
  });
});

it('calls onHarnessBooted callback after a new process boots', async () => {
  const { registry, factory } = createRegistry();
  const onBooted = vi.fn().mockResolvedValue(undefined);
  registry.setOnHarnessBooted(onBooted);

  const process = await registry.getOrSpawn('workspace-1', '/tmp/ws1');

  expect(onBooted).toHaveBeenCalledOnce();
  expect(onBooted).toHaveBeenCalledWith(process);
  expect(factory).toHaveBeenCalledTimes(1);
});

it('does NOT call onHarnessBooted when returning existing process', async () => {
  const { registry } = createRegistry();
  const onBooted = vi.fn().mockResolvedValue(undefined);
  registry.setOnHarnessBooted(onBooted);

  await registry.getOrSpawn('workspace-1', '/tmp/ws1');
  await registry.getOrSpawn('workspace-1', '/tmp/ws1'); // second call — reuses

  expect(onBooted).toHaveBeenCalledOnce(); // only once (first spawn)
});

it('swallows errors from onHarnessBooted — does not propagate to caller', async () => {
  const { registry } = createRegistry();
  const onBooted = vi.fn().mockRejectedValue(new Error('publish failed'));
  registry.setOnHarnessBooted(onBooted);

  // Should not throw even though onBooted fails
  await expect(registry.getOrSpawn('workspace-1', '/tmp/ws1')).resolves.toBeDefined();
});
