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
 * A published provider and its available models.
 */
export interface PublishedProvider {
  readonly providerID: string;
  readonly name: string;
  readonly models: ReadonlyArray<{ readonly modelID: string; readonly name: string }>;
}

/**
 * A snapshot of one harness type's capabilities.
 */
export interface HarnessCapabilities {
  /** Harness identifier (e.g. 'opencode-sdk'). */
  readonly name: string;
  /** Human-readable display name (e.g. 'Opencode'). */
  readonly displayName: string;
  /** Agents available in this harness. */
  readonly agents: readonly PublishedAgent[];
  /** Providers and their models. */
  readonly providers: readonly PublishedProvider[];
  /** Optional JSON schema for harness-specific config. */
  readonly configSchema?: unknown;
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
