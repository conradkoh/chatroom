/**
 * Domain use case: update capabilities for a single workspace harness.
 *
 * Queries a running BoundHarness for its current agents and providers,
 * assembles the capability payload, and publishes it via CapabilitiesPublisher.
 *
 * This is called by the daemon when it receives a refreshCapabilities command.
 */

import type { BoundHarness } from '../entities/bound-harness.js';
import type { CapabilitiesPublisher } from '../ports/capabilities-publisher.js';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface UpdateCapabilitiesDeps {
  readonly publisher: CapabilitiesPublisher;
  readonly machineId: string;
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface UpdateCapabilitiesInput {
  /** The running harness to query. */
  readonly harness: BoundHarness;
  /** Workspace the harness is bound to. */
  readonly workspace: {
    readonly workspaceId: string;
    readonly cwd: string;
    readonly name: string;
  };
}

// ─── Use case ─────────────────────────────────────────────────────────────────

/**
 * Query the harness for its current agents + providers and publish the result.
 *
 * Only publishes for the one workspace — the full machine registry entry is
 * built by merging with any existing entries for other workspaces.
 */
export async function updateCapabilities(
  deps: UpdateCapabilitiesDeps,
  input: UpdateCapabilitiesInput
): Promise<void> {
  const { publisher, machineId } = deps;
  const { harness, workspace } = input;

  const [agents, providers] = await Promise.all([
    harness.listAgents(),
    harness.listProviders(),
  ]);

  await publisher.publish({
    machineId,
    lastSeenAt: Date.now(),
    workspaces: [
      {
        workspaceId: workspace.workspaceId,
        cwd: workspace.cwd,
        name: workspace.name,
        harnesses: [
          {
            name: harness.type,
            displayName: harness.displayName,
            agents: [...agents],
            providers: [...providers],
          },
        ],
      },
    ],
  });
}
