import { describe, it, expect, vi } from 'vitest';

import { InMemoryCollectorRegistry } from './convex-collector-resolver.js';
import type { CapabilitiesCollector } from '../../domain/direct-harness/usecases/publish-capabilities.js';
import type { WorkspaceCapabilities } from '../../domain/direct-harness/entities/machine-capabilities.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCollector(name = 'test-harness'): CapabilitiesCollector {
  return {
    name,
    displayName: 'Test Harness',
    listAgents: vi.fn().mockResolvedValue([]),
    listProviders: vi.fn().mockResolvedValue([]),
  };
}

function makeWorkspace(overrides?: Partial<WorkspaceCapabilities>): WorkspaceCapabilities {
  return {
    workspaceId: `ws-${Math.random().toString(36).slice(2, 6)}`,
    cwd: '/test/ws',
    name: 'Test Workspace',
    harnesses: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('InMemoryCollectorRegistry', () => {
  it('returns empty collectors when nothing registered', async () => {
    const registry = new InMemoryCollectorRegistry();
    const collectors = await registry.getCollectors();
    expect(collectors).toEqual([]);
  });

  it('returns registered collectors', async () => {
    const registry = new InMemoryCollectorRegistry();
    const workspace = makeWorkspace();
    const collector = makeCollector('builder');

    registry.register(workspace.workspaceId, workspace, collector);
    const result = await registry.getCollectors();

    expect(result).toHaveLength(1);
    expect(result[0].workspace).toEqual(workspace);
    expect(result[0].collector).toBe(collector);
  });

  it('unregister removes a collector', async () => {
    const registry = new InMemoryCollectorRegistry();
    const ws1 = makeWorkspace();
    const ws2 = makeWorkspace();

    registry.register(ws1.workspaceId, ws1, makeCollector('a'));
    registry.register(ws2.workspaceId, ws2, makeCollector('b'));
    expect((await registry.getCollectors())).toHaveLength(2);

    registry.unregister(ws1.workspaceId);
    const result = await registry.getCollectors();
    expect(result).toHaveLength(1);
    expect(result[0].workspace.workspaceId).toBe(ws2.workspaceId);
  });

  it('unregister on unknown id is a no-op', () => {
    const registry = new InMemoryCollectorRegistry();
    expect(() => registry.unregister('nonexistent')).not.toThrow();
  });

  it('register can update an existing entry', async () => {
    const registry = new InMemoryCollectorRegistry();
    const workspace = makeWorkspace();
    const first = makeCollector('first');
    const second = makeCollector('second');

    registry.register(workspace.workspaceId, workspace, first);
    registry.register(workspace.workspaceId, workspace, second);

    const result = await registry.getCollectors();
    expect(result).toHaveLength(1);
    expect(result[0].collector.name).toBe('second');
  });

  it('multiple collectors across workspaces', async () => {
    const registry = new InMemoryCollectorRegistry();
    const ws1 = makeWorkspace({ name: 'Frontend' });
    const ws2 = makeWorkspace({ name: 'Backend' });

    registry.register(ws1.workspaceId, ws1, makeCollector('builder'));
    registry.register(ws2.workspaceId, ws2, makeCollector('planner'));

    const result = await registry.getCollectors();
    expect(result).toHaveLength(2);
    const names = result.map((r) => r.workspace.name).sort();
    expect(names).toEqual(['Backend', 'Frontend']);
  });
});
