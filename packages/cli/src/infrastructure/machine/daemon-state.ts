/**
 * Daemon State Storage
 *
 * Manages per-machine daemon runtime state in a dedicated file, separate from
 * the static machine configuration in machine.json.
 *
 * State files are stored at:
 *   ~/.chatroom/machines/state/<machine-id>.json
 *
 * This separation prevents write contention when a single machine works with
 * multiple backends. The machine.json file holds static config (identity, tools,
 * agent context), while this module handles volatile runtime state (spawned PIDs).
 *
 * File layout:
 * {
 *   "version": "1",
 *   "machineId": "uuid",
 *   "updatedAt": "ISO string",
 *   "agents": {
 *     "<chatroomId>/<role>": {
 *       "pid": 12345,
 *       "harness": "opencode",
 *       "startedAt": "ISO string"
 *     }
 *   }
 * }
 */

import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AgentHarness } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHATROOM_DIR = join(homedir(), '.chatroom');
const STATE_DIR = join(CHATROOM_DIR, 'machines', 'state');
const STATE_VERSION = '1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Runtime info for a single spawned agent */
export interface DaemonAgentEntry {
  /** OS process ID */
  pid: number;
  /** Which agent harness spawned it */
  harness: AgentHarness;
  /** When the agent was started (ISO string) */
  startedAt: string;
}

/** On-disk shape of a per-machine state file */
export interface DaemonStateFile {
  /** Schema version for forward-compat migrations */
  version: string;
  /** Machine UUID (matches machineId in machine.json) */
  machineId: string;
  /** Last time this file was written (ISO string) */
  updatedAt: string;
  /** Spawned agents keyed by "<chatroomId>/<role>" */
  agents: Record<string, DaemonAgentEntry>;
  /**
   * Last processed event stream event ID (string form of Convex `_id`).
   * Persisted so the daemon resumes from the correct cursor after restart.
   */
  lastSeenEventId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the composite key used in the agents map */
function agentKey(chatroomId: string, role: string): string {
  return `${chatroomId}/${role}`;
}

/** Ensure the state directory tree exists */
async function ensureStateDir(): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
}

/** Path to the state file for a given machine */
function stateFilePath(machineId: string): string {
  return join(STATE_DIR, `${machineId}.json`);
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

/**
 * Load the daemon state file for a machine.
 * Returns null if the file doesn't exist or is unreadable.
 */
export async function loadDaemonState(machineId: string): Promise<DaemonStateFile | null> {
  const filePath = stateFilePath(machineId);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as DaemonStateFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    // Corrupted file — caller should treat as empty
    return null;
  }
}

/**
 * Save the daemon state file using atomic write (write-to-tmp then rename).
 */
async function saveDaemonState(state: DaemonStateFile): Promise<void> {
  await ensureStateDir();
  const filePath = stateFilePath(state.machineId);
  const tempPath = `${filePath}.tmp`;
  const content = JSON.stringify(state, null, 2);

  // SECURITY: 0o600 restricts file access to owner only.
  await fs.writeFile(tempPath, content, { mode: 0o600 });

  // Atomic rename — safe against crashes mid-write.
  await fs.rename(tempPath, filePath);
}

/**
 * Load or create a fresh state file for the given machine.
 */
async function loadOrCreate(machineId: string): Promise<DaemonStateFile> {
  return (
    (await loadDaemonState(machineId)) ?? {
      version: STATE_VERSION,
      machineId,
      updatedAt: new Date().toISOString(),
      agents: {},
    }
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a spawned agent PID in the daemon state file.
 *
 * Called after a successful agent start so the daemon can recover it on restart.
 */
export async function persistAgentPid(
  machineId: string,
  chatroomId: string,
  role: string,
  pid: number,
  harness: AgentHarness
): Promise<void> {
  const state = await loadOrCreate(machineId);

  state.agents[agentKey(chatroomId, role)] = {
    pid,
    harness,
    startedAt: new Date().toISOString(),
  };
  state.updatedAt = new Date().toISOString();

  await saveDaemonState(state);
}

/**
 * Remove a spawned agent entry from the daemon state file.
 *
 * Called after a successful agent stop or when a stale PID is detected.
 */
export async function clearAgentPid(
  machineId: string,
  chatroomId: string,
  role: string
): Promise<void> {
  const state = await loadDaemonState(machineId);
  if (!state) return;

  const key = agentKey(chatroomId, role);
  if (!(key in state.agents)) return;

  delete state.agents[key];
  state.updatedAt = new Date().toISOString();

  await saveDaemonState(state);
}

/**
 * List all agent entries from the daemon state file.
 *
 * Returns an array of { chatroomId, role, entry } for iteration during
 * recovery. Returns an empty array when no state file exists.
 */
export async function listAgentEntries(
  machineId: string
): Promise<{ chatroomId: string; role: string; entry: DaemonAgentEntry }[]> {
  const state = await loadDaemonState(machineId);
  if (!state) return [];

  const results: { chatroomId: string; role: string; entry: DaemonAgentEntry }[] = [];

  for (const [key, entry] of Object.entries(state.agents)) {
    const separatorIndex = key.lastIndexOf('/');
    if (separatorIndex === -1) continue; // Malformed key — skip

    const chatroomId = key.substring(0, separatorIndex);
    const role = key.substring(separatorIndex + 1);
    results.push({ chatroomId, role, entry });
  }

  return results;
}

/**
 * Persist the event stream cursor (last processed event ID) to daemon state.
 *
 * Best-effort: if the write fails, logs a warning but does not throw.
 * Call this after each processed batch of stream events to survive daemon restarts.
 */
export async function persistEventCursor(machineId: string, lastSeenEventId: string): Promise<void> {
  try {
    const state = await loadOrCreate(machineId);
    state.lastSeenEventId = lastSeenEventId;
    state.updatedAt = new Date().toISOString();
    await saveDaemonState(state);
  } catch (err) {
    // Best-effort: log and continue — never block command processing
    console.warn(`⚠️  Failed to persist event cursor: ${(err as Error).message}`);
  }
}

/**
 * Load the event stream cursor from persisted daemon state.
 *
 * Returns the last seen event ID string if present, or null if none is stored.
 * Called at daemon startup to resume the stream from the correct position.
 */
export async function loadEventCursor(machineId: string): Promise<string | null> {
  const state = await loadDaemonState(machineId);
  return state?.lastSeenEventId ?? null;
}
