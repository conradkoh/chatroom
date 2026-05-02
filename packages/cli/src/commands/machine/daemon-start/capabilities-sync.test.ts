/**
 * Tests for MachineCapabilitiesCache and publishMachineSnapshot.
 */

import { describe, it, expect, vi } from 'vitest';
import { MachineCapabilitiesCache, publishMachineSnapshot } from './capabilities-sync.js';
import type { WorkspaceMeta } from './capabilities-sync.js';
import type { CapabilitiesPublisher } from '../../../domain/direct-harness/capabilities-publisher.js';
import type { PublishedAgent } from '../../../domain/direct-harness/index.js';

// ─── Test fixtures ───────────────────────────────────────────────────────────

const primaryAgent: PublishedAgent = {
  name: 'build',
  mode: 'primary',
  model: { providerID: 'anthropic', modelID: 'claude-3.5-sonnet' },
  description: 'The primary coding agent',
};

const allModeAgent: PublishedAgent = {
  name: 'chat',
  mode: 'all',
};

const subAgent: PublishedAgent = {
  name: 'review',
  mode: 'subagent',
};

const workspaceMetas: WorkspaceMeta[] = [
  { workspaceId: 'ws-1', cwd: '/home/user/project-a', name: 'project-a' },
  { workspaceId: 'ws-2', cwd: '/home/user/project-b', name: 'project-b' },
];

// ─── MachineCapabilitiesCache ────────────────────────────────────────────────

describe('MachineCapabilitiesCache', () => {
  it('builds workspaces with empty agents when cache has no entries', () => {
    const cache = new MachineCapabilitiesCache();
    const workspaces = cache.buildWorkspaces(workspaceMetas);

    expect(workspaces).toEqual([
      { workspaceId: 'ws-1', cwd: '/home/user/project-a', name: 'project-a', agents: [] },
      { workspaceId: 'ws-2', cwd: '/home/user/project-b', name: 'project-b', agents: [] },
    ]);
  });

  it('builds workspaces with cached agents for known workspaceIds', () => {
    const cache = new MachineCapabilitiesCache();
    cache.setAgents('ws-1', [primaryAgent]);

    const workspaces = cache.buildWorkspaces(workspaceMetas);

    expect(workspaces).toEqual([
      { workspaceId: 'ws-1', cwd: '/home/user/project-a', name: 'project-a', agents: [primaryAgent] },
      { workspaceId: 'ws-2', cwd: '/home/user/project-b', name: 'project-b', agents: [] },
    ]);
  });

  it('replaces agents when setAgents is called again for the same workspace', () => {
    const cache = new MachineCapabilitiesCache();
    cache.setAgents('ws-1', [primaryAgent]);
    cache.setAgents('ws-1', [allModeAgent, subAgent]);

    const workspaces = cache.buildWorkspaces(workspaceMetas);

    expect(workspaces[0].agents).toEqual([allModeAgent, subAgent]);
    expect(workspaces[0].agents).not.toContainEqual(primaryAgent);
  });

  it('includes workspaces from metas even if they have no cache entry', () => {
    const cache = new MachineCapabilitiesCache();
    // Only ws-2 has agents; ws-1 has no cache entry
    cache.setAgents('ws-2', [subAgent]);

    const workspaces = cache.buildWorkspaces(workspaceMetas);

    expect(workspaces).toEqual([
      { workspaceId: 'ws-1', cwd: '/home/user/project-a', name: 'project-a', agents: [] },
      { workspaceId: 'ws-2', cwd: '/home/user/project-b', name: 'project-b', agents: [subAgent] },
    ]);
  });

  it('ignores cache entries for workspaceIds not in metas', () => {
    const cache = new MachineCapabilitiesCache();
    cache.setAgents('ws-unknown', [primaryAgent]);

    const workspaces = cache.buildWorkspaces(workspaceMetas);

    // The unknown workspace is not included (not in metas)
    expect(workspaces).toHaveLength(2);
    expect(workspaces.every((ws) => ws.agents.length === 0)).toBe(true);
  });

  it('deletes a workspace entry from the cache', () => {
    const cache = new MachineCapabilitiesCache();
    cache.setAgents('ws-1', [primaryAgent]);
    cache.deleteWorkspace('ws-1');

    const workspaces = cache.buildWorkspaces(workspaceMetas);

    expect(workspaces[0].agents).toEqual([]);
  });

  it('is safe under concurrent setAgents calls (last-write-wins)', () => {
    const cache = new MachineCapabilitiesCache();
    // Simulate two concurrent onBooted callbacks setting agents for different workspaces
    cache.setAgents('ws-1', [primaryAgent]);
    cache.setAgents('ws-2', [allModeAgent]);

    const workspaces = cache.buildWorkspaces(workspaceMetas);

    expect(workspaces).toEqual([
      { workspaceId: 'ws-1', cwd: '/home/user/project-a', name: 'project-a', agents: [primaryAgent] },
      { workspaceId: 'ws-2', cwd: '/home/user/project-b', name: 'project-b', agents: [allModeAgent] },
    ]);
  });

  it('returns empty array when no metas are provided', () => {
    const cache = new MachineCapabilitiesCache();
    cache.setAgents('ws-1', [primaryAgent]);

    const workspaces = cache.buildWorkspaces([]);

    expect(workspaces).toEqual([]);
  });
});

// ─── publishMachineSnapshot ──────────────────────────────────────────────────

describe('publishMachineSnapshot', () => {
  it('publishes a full snapshot with cached agents', async () => {
    const cache = new MachineCapabilitiesCache();
    cache.setAgents('ws-1', [primaryAgent, subAgent]);

    const publishedCalls: unknown[] = [];
    const mockPublisher: CapabilitiesPublisher = {
      async publish(caps) {
        publishedCalls.push(caps);
      },
    };

    await publishMachineSnapshot(mockPublisher, cache, 'machine-123', workspaceMetas);

    expect(publishedCalls).toHaveLength(1);
    const caps = publishedCalls[0] as any;

    expect(caps.machineId).toBe('machine-123');
    expect(caps.lastSeenAt).toBeTypeOf('number');
    expect(caps.workspaces).toHaveLength(2);
    expect(caps.workspaces[0]).toEqual({
      workspaceId: 'ws-1',
      cwd: '/home/user/project-a',
      name: 'project-a',
      agents: [primaryAgent, subAgent],
    });
    expect(caps.workspaces[1]).toEqual({
      workspaceId: 'ws-2',
      cwd: '/home/user/project-b',
      name: 'project-b',
      agents: [],
    });
  });

  it('publishes with all empty agents when cache is empty', async () => {
    const cache = new MachineCapabilitiesCache();

    const publishedCalls: unknown[] = [];
    const mockPublisher: CapabilitiesPublisher = {
      async publish(caps) {
        publishedCalls.push(caps);
      },
    };

    await publishMachineSnapshot(mockPublisher, cache, 'machine-456', workspaceMetas);

    expect(publishedCalls).toHaveLength(1);
    const caps = publishedCalls[0] as any;

    expect(caps.machineId).toBe('machine-456');
    expect(caps.workspaces.every((ws: any) => ws.agents.length === 0)).toBe(true);
  });

  it('propagates publisher errors to the caller', async () => {
    const cache = new MachineCapabilitiesCache();
    const errorPublisher: CapabilitiesPublisher = {
      async publish() {
        throw new Error('publish failed');
      },
    };

    await expect(
      publishMachineSnapshot(errorPublisher, cache, 'machine-789', workspaceMetas)
    ).rejects.toThrow('publish failed');
  });
});