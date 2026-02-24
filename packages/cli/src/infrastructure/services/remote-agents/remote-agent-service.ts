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

/** Opaque context passed at spawn time and returned on exit/idle queries. */
export interface SpawnContext {
  machineId: string;
  chatroomId: string;
  role: string;
}

export interface SpawnOptions {
  workingDir: string;
  prompt: string;
  model?: string;
  context: SpawnContext;
}

export interface SpawnResult {
  pid: number;
  onExit: (
    cb: (info: { code: number | null; signal: string | null; context: SpawnContext }) => void
  ) => void;
  onOutput: (cb: () => void) => void;
}

export interface ProcessInfo {
  pid: number;
  context: SpawnContext;
  lastOutputAt: number;
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

  /** Get all tracked processes with their context and activity timestamps. */
  getTrackedProcesses(): ProcessInfo[];

  /** Remove a process from tracking (call on cleanup). */
  untrack(pid: number): void;
}
