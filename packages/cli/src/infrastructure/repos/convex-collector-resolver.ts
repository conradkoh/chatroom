/**
 * In-memory CollectorResolver implementation.
 *
 * Maintains a registry of CapabilitiesCollectors keyed by workspaceId.
 * The daemon populates this registry as harnesses boot and removes them
 * when harnesses shut down. The publishCapabilities use case reads the
 * current state via getCollectors().
 *
 * Not backed by Convex — the daemon already knows its workspaces and
 * harnesses locally. This is a simple Map<string, CapabilitiesCollector>.
 */

import type { CollectorResolver, CapabilitiesCollector } from '../../domain/direct-harness/usecases/publish-capabilities.js';
import type { WorkspaceCapabilities } from '../../domain/direct-harness/entities/machine-capabilities.js';

export class InMemoryCollectorRegistry implements CollectorResolver {
  /** workspaceId → { collector, workspace base info } */
  private readonly entries = new Map<
    string,
    { workspace: WorkspaceCapabilities; collector: CapabilitiesCollector }
  >();

  /**
   * Register (or update) a collector for a workspace.
   * Called by the daemon when a harness finishes booting.
   */
  register(
    workspaceId: string,
    workspace: WorkspaceCapabilities,
    collector: CapabilitiesCollector
  ): void {
    this.entries.set(workspaceId, { workspace, collector });
  }

  /** Remove a collector. Called when a harness shuts down. */
  unregister(workspaceId: string): void {
    this.entries.delete(workspaceId);
  }

  async getCollectors(): Promise<
    readonly { workspace: WorkspaceCapabilities; collector: CapabilitiesCollector }[]
  > {
    return Array.from(this.entries.values());
  }
}
