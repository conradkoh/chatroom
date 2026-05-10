/**
 * Capabilities published by a daemon machine.
 *
 * Uses shared types from @workspace/backend for agent, provider, and harness
 * shapes. The MachineCapabilities wrapper is CLI-specific.
 */

import type {
  HarnessAgent,
  HarnessCapability,
  HarnessProvider,
} from '@workspace/backend/src/domain/direct-harness/types';

/**
 * A published provider and its available models.
 * Alias for shared HarnessAgent to maintain CLI naming convention.
 */
export type PublishedAgent = HarnessAgent;

/**
 * A published provider and its available models.
 * Alias for shared HarnessProvider.
 */
export type PublishedProvider = HarnessProvider;

/**
 * A snapshot of one harness type's capabilities.
 * Alias for shared HarnessCapability.
 */
export type HarnessCapabilities = HarnessCapability;

/**
 * A snapshot of one workspace's entry in the machine registry.
 * Carries only the fields needed for UI rendering.
 */
export interface WorkspaceCapabilities {
  /** Convex Id of the chatroom_workspaces row. */
  readonly workspaceId: string;
  /** Absolute path to the working directory on the machine. */
  readonly cwd: string;
  /** Human-readable workspace label. */
  readonly name: string;
  /** Harnesses published by the running daemon, or empty if no harness is up yet. */
  readonly harnesses: readonly HarnessCapabilities[];
}

/**
 * Full capabilities payload published by a daemon machine.
 * One registry row per machineId is maintained (upsert semantics).
 */
export interface MachineCapabilities {
  readonly machineId: string;
  /** Epoch ms when this snapshot was assembled. */
  readonly lastSeenAt: number;
  /** All workspaces registered by this machine. */
  readonly workspaces: readonly WorkspaceCapabilities[];
}
