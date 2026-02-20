/**
 * RemoteAgentService — interface for interacting with remote AI agent runtimes.
 *
 * Each agent runtime (OpenCode, Aider, etc.) implements this interface.
 * The daemon and CLI use this contract to spawn, stop, and query agents
 * without coupling to a specific runtime.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VersionInfo {
  version: string;
  major: number;
}

export interface SpawnOptions {
  workingDir: string;
  prompt: string;
  model?: string;
}

export interface SpawnResult {
  pid: number;
  onExit: (cb: (code: number | null, signal: string | null) => void) => void;
  onOutput: (cb: () => void) => void;
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface RemoteAgentService {
  /** Is the agent runtime installed on this machine? */
  isInstalled(): boolean;

  /** What version is installed? Returns null if not installed or undetectable. */
  getVersion(): VersionInfo | null;

  /** List available AI models from the runtime. */
  listModels(): Promise<string[]>;

  /** Spawn an agent process. Returns PID + lifecycle callbacks. */
  spawn(options: SpawnOptions): Promise<SpawnResult>;

  /** Stop an agent by PID (SIGTERM → wait → SIGKILL). */
  stop(pid: number): Promise<void>;

  /** Is this PID still alive? */
  isAlive(pid: number): boolean;
}
