/**
 * Domain use case: collect and publish machine capabilities.
 *
 * Orchestrates:
 *   1. Resolve collectors for all active workspaces on this machine
 *   2. For each workspace, collect agents + providers from the harness
 *   3. Assemble HarnessCapabilities for each running harness
 *   4. Merge into WorkspaceCapabilities (base info + populated harnesses)
 *   5. Build the top-level MachineCapabilities payload
 *   6. Publish via CapabilitiesPublisher
 */

import type {
  HarnessCapabilities,
  MachineCapabilities,
  PublishedAgent,
  PublishedProvider,
  WorkspaceCapabilities,
} from '../entities/machine-capabilities.js';
import type { CapabilitiesPublisher } from '../ports/capabilities-publisher.js';

// ─── Ports ────────────────────────────────────────────────────────────────────

/** Collects available agents and providers from a running harness. */
export interface CapabilitiesCollector {
  listAgents(): Promise<readonly PublishedAgent[]>;
  listProviders(): Promise<readonly PublishedProvider[]>;
  /** Harness identifier (e.g. 'opencode-sdk'). */
  readonly name: string;
  /** Human-readable display name. */
  readonly displayName: string;
  /** Optional JSON schema for harness-specific config. */
  readonly configSchema?: unknown;
}

/** Resolves collectors for all active workspaces on this machine. */
export interface CollectorResolver {
  getCollectors(): Promise<readonly { workspace: WorkspaceCapabilities; collector: CapabilitiesCollector }[]>;
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface PublishCapabilitiesDeps {
  readonly collectorResolver: CollectorResolver;
  readonly publisher: CapabilitiesPublisher;
  readonly machineId: string;
  readonly nowFn?: () => number;
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface PublishCapabilitiesInput {
  /** The base workspace list before populating harness details. */
  readonly workspaces: readonly WorkspaceCapabilities[];
}

// ─── Use case function ────────────────────────────────────────────────────────

export async function publishCapabilities(
  deps: PublishCapabilitiesDeps,
  input: PublishCapabilitiesInput
): Promise<void> {
  const { collectorResolver, publisher, machineId, nowFn = Date.now } = deps;
  const { workspaces } = input;

  // 1. Resolve collectors for all active workspaces
  const collectorEntries = await collectorResolver.getCollectors();

  // 2. Collect capability details from each running harness
  const workspaceCapabilities: WorkspaceCapabilities[] = [];

  for (const { workspace, collector } of collectorEntries) {
    const [agents, providers] = await Promise.all([
      collector.listAgents(),
      collector.listProviders(),
    ]);

    const harness: HarnessCapabilities = {
      name: collector.name,
      displayName: collector.displayName,
      agents,
      providers,
      ...(collector.configSchema !== undefined ? { configSchema: collector.configSchema } : {}),
    };

    // Merge into the base workspace info
    workspaceCapabilities.push({
      workspaceId: workspace.workspaceId,
      cwd: workspace.cwd,
      name: workspace.name,
      harnesses: [harness],
    });
  }

  // 3. Include any workspaces that have no active collectors (empty harness list)
  const collectedIds = new Set(workspaceCapabilities.map((w) => w.workspaceId));
  for (const ws of workspaces) {
    if (!collectedIds.has(ws.workspaceId)) {
      workspaceCapabilities.push({
        workspaceId: ws.workspaceId,
        cwd: ws.cwd,
        name: ws.name,
        harnesses: [],
      });
    }
  }

  // 4. Build the top-level payload and publish
  const payload: MachineCapabilities = {
    machineId,
    lastSeenAt: nowFn(),
    workspaces: workspaceCapabilities,
  };

  await publisher.publish(payload);
}
