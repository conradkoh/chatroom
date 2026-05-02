/**
 * Capabilities sync — in-memory cache + publish helper for machine capabilities.
 *
 * Centralizes the "build full payload + publish" logic so that:
 * - init.ts can use it for the initial empty-harnesses publish on daemon start
 * - TheHarnessBooted callback can use it to incrementally update a single
 *   workspace's harness list and republish the full snapshot
 *
 * DRY: both paths go through `publishMachineSnapshot()`, which reads from the
 * cache + workspace metadata to assemble the MachineCapabilities payload.
 */

import type {
  HarnessCapabilities,
  PublishedAgent,
  WorkspaceCapabilities,
  MachineCapabilities,
} from '../../../domain/direct-harness/index.js';
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
 * In-memory cache mapping workspaceId → published harnesses.
 *
 * Thread safety: last-write-wins per workspaceId, then publish full snapshot.
 * Convex mutations serialize on the backend, so a simple Map is safe for
 * concurrent onBooted callbacks from different workspaces.
 */
export class MachineCapabilitiesCache {
  private readonly harnesses = new Map<string, HarnessCapabilities[]>();

  /** Set (or replace) the harness list for a single workspace. */
  setHarnesses(workspaceId: string, harnesses: HarnessCapabilities[]): void {
    this.harnesses.set(workspaceId, harnesses);
  }

  /**
   * @deprecated Use setHarnesses instead.
   * Compatibility shim: wraps the provided agents under a single opencode-sdk harness entry.
   */
  setAgents(workspaceId: string, agents: PublishedAgent[]): void {
    this.harnesses.set(workspaceId, [
      {
        name: 'opencode-sdk',
        displayName: 'Opencode',
        agents,
        providers: [],
      },
    ]);
  }

  /**
   * Remove a workspace's harness entry.
   * Used when a workspace is deregistered or the daemon resets.
   */
  deleteWorkspace(workspaceId: string): void {
    this.harnesses.delete(workspaceId);
  }

  /**
   * Build the workspaces array suitable for publishing.
   *
   * Merges cached harnesses with the supplied metadata. Workspaces in `metas`
   * that have no cached harnesses still appear with `harnesses: []` (so the UI
   * shows them as not-yet-ready until their harness boots).
   */
  buildWorkspaces(metas: readonly WorkspaceMeta[]): WorkspaceCapabilities[] {
    return metas.map((ws) => ({
      workspaceId: ws.workspaceId,
      cwd: ws.cwd,
      name: ws.name,
      harnesses: this.harnesses.get(ws.workspaceId) ?? [],
    }));
  }
}

// ─── Publish helper ──────────────────────────────────────────────────────────

/**
 * Build a full MachineCapabilities snapshot and publish it via the publisher.
 *
 * This is the single code path for both the initial empty-harnesses publish
 * (init.ts) and the incremental onBooted republish (command-loop.ts).
 */
export async function publishMachineSnapshot(
  publisher: CapabilitiesPublisher,
  cache: MachineCapabilitiesCache,
  machineId: string,
  workspaceMetas: readonly WorkspaceMeta[]
): Promise<void> {
  const workspaces = cache.buildWorkspaces(workspaceMetas);
  const caps: MachineCapabilities = {
    machineId,
    lastSeenAt: Date.now(),
    workspaces,
  };
  await publisher.publish(caps);
}
