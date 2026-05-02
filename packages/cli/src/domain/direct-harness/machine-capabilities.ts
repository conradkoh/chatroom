/**
 * Trimmed representation of an opencode agent for publishing to the backend.
 *
 * Only identity fields are published — no permission maps, tool configs,
 * or prompts. The UI needs just enough to render an agent picker.
 */
export interface PublishedAgent {
  /** The agent's unique name within the opencode server (e.g. 'build'). */
  readonly name: string;
  /** The agent's interaction mode. */
  readonly mode: 'subagent' | 'primary' | 'all';
  /** The model this agent uses, if explicitly configured. */
  readonly model?: {
    readonly providerID: string;
    readonly modelID: string;
  };
  /** Optional human-readable description from the agent config. */
  readonly description?: string;
}

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
  /** Agents published by the running harness, or empty if no harness is up yet. */
  readonly agents: readonly PublishedAgent[];
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
