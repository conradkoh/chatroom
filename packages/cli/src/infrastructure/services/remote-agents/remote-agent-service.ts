/**
 * RemoteAgentService — interface for interacting with remote AI agent runtimes.
 *
 * Each agent runtime (OpenCode, Aider, etc.) implements this interface.
 * The daemon and CLI use this contract to spawn, stop, and query agents
 * without coupling to a specific runtime.
 */

import type { SpawnPrompt } from './spawn-prompt.js';

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
  /**
   * The immediate action or message to deliver to the agent.
   *
   * Constructed via `createSpawnPrompt()` at the use-case layer
   * (`agent-process-manager`) and guaranteed non-empty / non-whitespace by
   * the type system. Adapters MUST NOT inject their own fallback — the
   * invariant is centralised in `spawn-prompt.ts`.
   */
  prompt: SpawnPrompt;
  /**
   * The role/system prompt that establishes the agent's identity and context.
   * Always provided. Each service decides whether to pass it separately
   * (e.g. Pi's --system-prompt flag) or combine it with the prompt
   * (e.g. OpenCode prepends it to stdin input).
   */
  systemPrompt: string;
  model?: string;
  context: SpawnContext;
}

export interface SpawnResult {
  pid: number;
  onExit: (
    cb: (info: { code: number | null; signal: string | null; context: SpawnContext }) => void
  ) => void;
  onOutput: (cb: () => void) => void;
  /**
   * Optional: fires when the agent completes a turn (agent_end event).
   * Not all agent runtimes support this — implemented by PiAgentService and CursorAgentService.
   */
  onAgentEnd?: (cb: () => void) => void;
}

export interface ProcessInfo {
  pid: number;
  context: SpawnContext;
  lastOutputAt: number;
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface RemoteAgentService {
  /** Unique string identifier (e.g. 'opencode', 'cursor') — used in DB, config, and type unions */
  readonly id: string;
  /** Human-readable display name (e.g. 'OpenCode', 'Cursor') — used in UI */
  readonly displayName: string;
  /** CLI command used to check installation and invoke this harness (e.g. 'opencode', 'agent') */
  readonly command: string;

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
