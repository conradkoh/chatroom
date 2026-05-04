/**
 * Convex-backed CollectorResolver.
 *
 * Reads the machine registry via the capabilities.listForWorkspace query to
 * discover active workspaces, and creates CapabilitiesCollector instances
 * for each workspace's registered harnesses.
 *
 * The collectors themselves delegate back to Convex queries to fetch the
 * latest agent/provider lists.
 */

import { api } from '../../api.js';
import type { CollectorResolver, CapabilitiesCollector } from '../../domain/direct-harness/usecases/publish-capabilities.js';
import type { WorkspaceCapabilities, PublishedAgent, PublishedProvider } from '../../domain/direct-harness/entities/machine-capabilities.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendCall = (endpoint: any, args: any) => Promise<any>;

export interface ConvexCollectorResolverOptions {
  readonly backend: { mutation: BackendCall; query: BackendCall };
  readonly sessionId: string;
  readonly machineId: string;
}

export class ConvexCollectorResolver implements CollectorResolver {
  constructor(private readonly options: ConvexCollectorResolverOptions) {}

  async getCollectors(): Promise<
    readonly { workspace: WorkspaceCapabilities; collector: CapabilitiesCollector }[]
  > {
    const { backend, sessionId, machineId } = this.options;

    const registry = await backend.query(
      api.chatroom.directHarness.capabilities.listForWorkspace,
      { sessionId, machineId }
    ) as {
      workspaceId: string;
      cwd: string;
      name: string;
      harnesses?: Array<{
        name: string;
        displayName: string;
        agents: Array<{ name: string; mode: string; description?: string; model?: { providerID: string; modelID: string } }>;
        providers: Array<{
          providerID: string;
          name: string;
          models: Array<{ modelID: string; name: string }>;
        }>;
        configSchema?: unknown;
      }>;
    }[];

    return registry
      .filter((entry) => entry.harnesses && entry.harnesses.length > 0)
      .flatMap((entry) =>
        (entry.harnesses ?? []).map((h) => ({
          workspace: {
            workspaceId: entry.workspaceId,
            cwd: entry.cwd,
            name: entry.name,
            harnesses: [],
          } satisfies WorkspaceCapabilities,
          collector: {
            name: h.name,
            displayName: h.displayName,
            configSchema: h.configSchema,
            listAgents: async (): Promise<readonly PublishedAgent[]> =>
              h.agents.map((a) => ({
                name: a.name,
                mode: a.mode as 'subagent' | 'primary' | 'all',
                ...(a.description ? { description: a.description } : {}),
                ...(a.model ? { model: a.model } : {}),
              })),
            listProviders: async (): Promise<readonly PublishedProvider[]> =>
              h.providers.map((p) => ({
                providerID: p.providerID,
                name: p.name,
                models: p.models,
              })),
          } satisfies CapabilitiesCollector,
        }))
      );
  }
}
