/**
 * Tests for MachineCapabilitiesCache and publishMachineSnapshot.
 */

import { describe, it, expect } from 'vitest';
import { MachineCapabilitiesCache, publishMachineSnapshot } from './capabilities-sync.js';
import type { WorkspaceMeta } from './capabilities-sync.js';
import type { CapabilitiesPublisher } from '../../../domain/direct-harness/capabilities-publisher.js';
import type { HarnessCapabilities, PublishedAgent } from '../../../domain/direct-harness/index.js';

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

const opencodeSdkHarness = (agents: PublishedAgent[]): HarnessCapabilities => ({
  name: 'opencode-sdk',
  displayName: 'Opencode',
  agents,
  providers: [],
});

const workspaceMetas: WorkspaceMeta[] = [
  { workspaceId: 'ws-1', cwd: '/home/user/project-a', name: 'project-a' },
  { workspaceId: 'ws-2', cwd: '/home/user/project-b', name: 'project-b' },
];

// ─── MachineCapabilitiesCache ────────────────────────────────────────────────

describe('MachineCapabilitiesCache', () => {
  it('builds workspaces with empty harnesses when cache has no entries', () => {
    const cache = new MachineCapabilitiesCache();
    const workspaces = cache.buildWorkspaces(workspaceMetas);

    expect(workspaces).toEqual([
      { workspaceId: 'ws-1', cwd: '/home/user/project-a', name: 'project-a', harnesses: [] },
      { workspaceId: 'ws-2', cwd: '/home/user/project-b', name: 'project-b', harnesses: [] },
    ]);
  });

  it('builds workspaces with cached harnesses for known workspaceIds', () => {
    const cache = new MachineCapabilitiesCache();
    cache.setHarnesses('ws-1', [opencodeSdkHarness([primaryAgent])]);

    const workspaces = cache.buildWorkspaces(workspaceMetas);

    expect(workspaces[0].harnesses).toHaveLength(1);
    expect(workspaces[0].harnesses[0].name).toBe('opencode-sdk');
    expect(workspaces[0].harnesses[0].agents).toEqual([primaryAgent]);
    expect(workspaces[1].harnesses).toEqual([]);
  });

  it('replaces harnesses when setHarnesses is called again for the same workspace', () => {
    const cache = new MachineCapabilitiesCache();
    cache.setHarnesses('ws-1', [opencodeSdkHarness([primaryAgent])]);
    cache.setHarnesses('ws-1', [opencodeSdkHarness([allModeAgent, subAgent])]);

    const workspaces = cache.buildWorkspaces(workspaceMetas);

    expect(workspaces[0].harnesses[0].agents).toEqual([allModeAgent, subAgent]);
    expect(workspaces[0].harnesses[0].agents).not.toContainEqual(primaryAgent);
  });

  it('includes workspaces from metas even if they have no cache entry', () => {
    const cache = new MachineCapabilitiesCache();
    // Only ws-2 has harnesses; ws-1 has no cache entry
    cache.setHarnesses('ws-2', [opencodeSdkHarness([subAgent])]);

    const workspaces = cache.buildWorkspaces(workspaceMetas);

    expect(workspaces[0].harnesses).toEqual([]);
    expect(workspaces[1].harnesses[0].agents).toEqual([subAgent]);
  });

  it('ignores cache entries for workspaceIds not in metas', () => {
    const cache = new MachineCapabilitiesCache();
    cache.setHarnesses('ws-unknown', [opencodeSdkHarness([primaryAgent])]);

    const workspaces = cache.buildWorkspaces(workspaceMetas);

    // The unknown workspace is not included (not in metas)
    expect(workspaces).toHaveLength(2);
    expect(workspaces.every((ws) => ws.harnesses.length === 0)).toBe(true);
  });

  it('deletes a workspace entry from the cache', () => {
    const cache = new MachineCapabilitiesCache();
    cache.setHarnesses('ws-1', [opencodeSdkHarness([primaryAgent])]);
    cache.deleteWorkspace('ws-1');

    const workspaces = cache.buildWorkspaces(workspaceMetas);

    expect(workspaces[0].harnesses).toEqual([]);
  });

  it('is safe under concurrent setHarnesses calls (last-write-wins)', () => {
    const cache = new MachineCapabilitiesCache();
    // Simulate two concurrent onBooted callbacks setting harnesses for different workspaces
    cache.setHarnesses('ws-1', [opencodeSdkHarness([primaryAgent])]);
    cache.setHarnesses('ws-2', [opencodeSdkHarness([allModeAgent])]);

    const workspaces = cache.buildWorkspaces(workspaceMetas);

    expect(workspaces[0].harnesses[0].agents).toEqual([primaryAgent]);
    expect(workspaces[1].harnesses[0].agents).toEqual([allModeAgent]);
  });

  it('returns empty array when no metas are provided', () => {
    const cache = new MachineCapabilitiesCache();
    cache.setHarnesses('ws-1', [opencodeSdkHarness([primaryAgent])]);

    const workspaces = cache.buildWorkspaces([]);

    expect(workspaces).toEqual([]);
  });
});

// ─── publishMachineSnapshot ──────────────────────────────────────────────────

describe('publishMachineSnapshot', () => {
  it('publishes a full snapshot with cached harnesses', async () => {
    const cache = new MachineCapabilitiesCache();
    cache.setHarnesses('ws-1', [opencodeSdkHarness([primaryAgent, subAgent])]);

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
    expect(caps.workspaces[0].workspaceId).toBe('ws-1');
    expect(caps.workspaces[0].harnesses[0].agents).toEqual([primaryAgent, subAgent]);
    expect(caps.workspaces[1].harnesses).toEqual([]);
  });

  it('publishes with all empty harnesses when cache is empty', async () => {
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
    expect(caps.workspaces.every((ws: any) => ws.harnesses.length === 0)).toBe(true);
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
