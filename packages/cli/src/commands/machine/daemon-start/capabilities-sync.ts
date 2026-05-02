/**
 * Capabilities sync — in-memory cache + publish helper for machine capabilities.
 *
 * Centralizes the "build full payload + publish" logic so that:
 * - init.ts can use it for the initial empty-agents publish on daemon start
 * - TheHarnessBooted callback can use it to incrementally update a single
 *   workspace's agent list and republish the full snapshot
 *
 * DRY: both paths go through `publishMachineSnapshot()`, which reads from the
 * cache + workspace metadata to assemble the MachineCapabilities payload.
 */

import type { PublishedAgent, WorkspaceCapabilities, MachineCapabilities } from '../../../domain/direct-harness/index.js';
import type { CapabilitiesPublisher } from '../../../domain/direct-harness/capabilities-publisher.js';

// ─── Workspace metadata ─────────────────────────────────────────────────────

/** Minimal metadata needed per workspace to build a registry payload. */
export interface WorkspaceMeta {
  /** Convex Id of the chatroom_workspaces row. */
  readonly workspaceId: string;
  /** Absolute path to the working directory on the machine. */
  readonly cwd: string;
  /** Human-readable workspace label. */
  readonly name: string;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

/**
 * In-memory cache mapping workspaceId → published agents.
 *
 * Thread safety: last-write-wins per workspaceId, then publish full snapshot.
 * Convex mutations serialize on the backend, so a simple Map is safe for
 * concurrent onBooted callbacks from different workspaces.
 */
export class MachineCapabilitiesCache {
  private readonly agents = new Map<string, PublishedAgent[]>();

  /** Set (or replace) the agent list for a single workspace. */
  setAgents(workspaceId: string, agents: PublishedAgent[]): void {
    this.agents.set(workspaceId, agents);
  }

  /**
   * Remove a workspace's agent entry.
   * Used when a workspace is deregistered or the daemon resets.
   */
  deleteWorkspace(workspaceId: string): void {
    this.agents.delete(workspaceId);
  }

  /**
   * Build the workspaces array suitable for publishing.
   *
   * Merges cached agents with the supplied metadata. Workspaces in `metas`
   * that have no cached agents still appear with `agents: []` (so the UI
   * shows them with the disabled tooltip until their harness boots).
   */
  buildWorkspaces(metas: readonly WorkspaceMeta[]): WorkspaceCapabilities[] {
    return metas.map((ws) => ({
      workspaceId: ws.workspaceId,
      cwd: ws.cwd,
      name: ws.name,
      agents: this.agents.get(ws.workspaceId) ?? [],
    }));
  }
}

// ─── Publish helper ──────────────────────────────────────────────────────────

/**
 * Build a full MachineCapabilities snapshot and publish it via the publisher.
 *
 * This is the single code path for both the initial empty-agents publish
 * (init.ts) and the incremental onBooted republish (command-loop.ts).
 */
export async function publishMachineSnapshot(
  publisher: CapabilitiesPublisher,
  cache: MachineCapabilitiesCache,
  machineId: string,
  workspaceMetas: readonly WorkspaceMeta[],
): Promise<void> {
  const workspaces = cache.buildWorkspaces(workspaceMetas);
  const caps: MachineCapabilities = {
    machineId,
    lastSeenAt: Date.now(),
    workspaces,
  };
  await publisher.publish(caps);
}