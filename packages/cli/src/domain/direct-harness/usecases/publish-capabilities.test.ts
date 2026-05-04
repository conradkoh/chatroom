import { describe, it, expect, vi } from 'vitest';

import { publishCapabilities } from './publish-capabilities.js';
import type { PublishCapabilitiesDeps, PublishCapabilitiesInput } from './publish-capabilities.js';
import type { CapabilitiesCollector, CollectorResolver } from './publish-capabilities.js';
import type { CapabilitiesPublisher } from '../ports/capabilities-publisher.js';
import type {
  MachineCapabilities,
  PublishedAgent,
  PublishedProvider,
  WorkspaceCapabilities,
} from '../entities/machine-capabilities.js';

function stubAgent(name = 'builder'): PublishedAgent {
  return { name, mode: 'primary', description: `Agent ${name}` };
}

function stubProvider(id = 'openai'): PublishedProvider {
  return {
    providerID: id,
    name: id,
    models: [{ modelID: 'gpt-4', name: 'GPT-4' }],
  };
}

function baseWorkspace(overrides?: Partial<WorkspaceCapabilities>): WorkspaceCapabilities {
  return {
    workspaceId: 'ws-1',
    cwd: '/projects/test',
    name: 'Test Workspace',
    harnesses: [],
    ...overrides,
  };
}

describe('publishCapabilities', () => {
  it('collects agents and providers and publishes the payload', async () => {
    const collector: CapabilitiesCollector = {
      name: 'opencode-sdk',
      displayName: 'Opencode',
      configSchema: { type: 'object' },
      listAgents: vi.fn().mockResolvedValue([stubAgent()]),
      listProviders: vi.fn().mockResolvedValue([stubProvider()]),
    };
    const collectorResolver: CollectorResolver = {
      getCollectors: vi.fn().mockResolvedValue([
        { workspace: baseWorkspace(), collector },
      ]),
    };
    const publisher: CapabilitiesPublisher = {
      publish: vi.fn(),
    };
    const deps: PublishCapabilitiesDeps = {
      collectorResolver,
      publisher,
      machineId: 'machine-1',
      nowFn: () => 1000,
    };
    const input: PublishCapabilitiesInput = {
      workspaces: [baseWorkspace()],
    };

    await publishCapabilities(deps, input);

    expect(collector.listAgents).toHaveBeenCalledOnce();
    expect(collector.listProviders).toHaveBeenCalledOnce();
    expect(publisher.publish).toHaveBeenCalledOnce();

    const payload = (publisher.publish as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as MachineCapabilities;
    expect(payload.machineId).toBe('machine-1');
    expect(payload.lastSeenAt).toBe(1000);
    expect(payload.workspaces).toHaveLength(1);
    expect(payload.workspaces[0].harnesses[0].agents).toEqual([stubAgent()]);
    expect(payload.workspaces[0].harnesses[0].providers).toEqual([stubProvider()]);
    expect(payload.workspaces[0].harnesses[0].name).toBe('opencode-sdk');
    expect(payload.workspaces[0].harnesses[0].configSchema).toEqual({ type: 'object' });
  });

  it('includes workspaces without active collectors (empty harnesses)', async () => {
    const collectorResolver: CollectorResolver = {
      getCollectors: vi.fn().mockResolvedValue([]),
    };
    const publisher: CapabilitiesPublisher = { publish: vi.fn() };
    const deps: PublishCapabilitiesDeps = {
      collectorResolver,
      publisher,
      machineId: 'machine-1',
      nowFn: () => 1000,
    };
    const input: PublishCapabilitiesInput = {
      workspaces: [
        baseWorkspace({ workspaceId: 'ws-1', name: 'Alpha' }),
        baseWorkspace({ workspaceId: 'ws-2', name: 'Beta' }),
      ],
    };

    await publishCapabilities(deps, input);

    const payload = (publisher.publish as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as MachineCapabilities;
    expect(payload.workspaces).toHaveLength(2);
    expect(payload.workspaces[0].harnesses).toEqual([]);
    expect(payload.workspaces[1].harnesses).toEqual([]);
  });

  it('collector with empty agent/provider lists publishes empty arrays', async () => {
    const collector: CapabilitiesCollector = {
      name: 'opencode-sdk',
      displayName: 'Opencode',
      listAgents: vi.fn().mockResolvedValue([]),
      listProviders: vi.fn().mockResolvedValue([]),
    };
    const collectorResolver: CollectorResolver = {
      getCollectors: vi.fn().mockResolvedValue([
        { workspace: baseWorkspace(), collector },
      ]),
    };
    const publisher: CapabilitiesPublisher = { publish: vi.fn() };
    const deps: PublishCapabilitiesDeps = {
      collectorResolver,
      publisher,
      machineId: 'machine-1',
      nowFn: () => 1000,
    };
    const input: PublishCapabilitiesInput = {
      workspaces: [baseWorkspace()],
    };

    await publishCapabilities(deps, input);

    const payload = (publisher.publish as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as MachineCapabilities;
    expect(payload.workspaces[0].harnesses[0].agents).toEqual([]);
    expect(payload.workspaces[0].harnesses[0].providers).toEqual([]);
  });

  it('propagates errors from the publisher', async () => {
    const collectorResolver: CollectorResolver = {
      getCollectors: vi.fn().mockResolvedValue([]),
    };
    const publisher: CapabilitiesPublisher = {
      publish: vi.fn().mockRejectedValue(new Error('network error')),
    };
    const deps: PublishCapabilitiesDeps = {
      collectorResolver,
      publisher,
      machineId: 'machine-1',
      nowFn: () => 1000,
    };
    const input: PublishCapabilitiesInput = {
      workspaces: [baseWorkspace()],
    };

    await expect(publishCapabilities(deps, input)).rejects.toThrow('network error');
  });

  it('uses Date.now when nowFn is not provided', async () => {
    const collectorResolver: CollectorResolver = {
      getCollectors: vi.fn().mockResolvedValue([]),
    };
    const publisher: CapabilitiesPublisher = { publish: vi.fn() };
    const deps: PublishCapabilitiesDeps = {
      collectorResolver,
      publisher,
      machineId: 'machine-1',
      // no nowFn — should use Date.now
    };
    const input: PublishCapabilitiesInput = {
      workspaces: [baseWorkspace()],
    };
    const before = Date.now();

    await publishCapabilities(deps, input);

    const payload = (publisher.publish as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as MachineCapabilities;
    expect(payload.lastSeenAt).toBeGreaterThanOrEqual(before);
    expect(payload.lastSeenAt).toBeLessThanOrEqual(Date.now());
  });
});
