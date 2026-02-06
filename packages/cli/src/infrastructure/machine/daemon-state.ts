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
 *       "tool": "opencode",
 *       "startedAt": "ISO string"
 *     }
 *   }
 * }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AgentTool } from './types.js';

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
  /** Which agent tool spawned it */
  tool: AgentTool;
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the composite key used in the agents map */
function agentKey(chatroomId: string, role: string): string {
  return `${chatroomId}/${role}`;
}

/** Ensure the state directory tree exists */
function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    // SECURITY: 0o700 restricts directory access to owner only.
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }
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
export function loadDaemonState(machineId: string): DaemonStateFile | null {
  const filePath = stateFilePath(machineId);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as DaemonStateFile;
  } catch {
    // Corrupted file — caller should treat as empty
    return null;
  }
}

/**
 * Save the daemon state file using atomic write (write-to-tmp then rename).
 */
function saveDaemonState(state: DaemonStateFile): void {
  ensureStateDir();
  const filePath = stateFilePath(state.machineId);
  const tempPath = `${filePath}.tmp`;
  const content = JSON.stringify(state, null, 2);

  // SECURITY: 0o600 restricts file access to owner only.
  writeFileSync(tempPath, content, { encoding: 'utf-8', mode: 0o600 });

  // Atomic rename — safe against crashes mid-write.
  renameSync(tempPath, filePath);
}

/**
 * Load or create a fresh state file for the given machine.
 */
function loadOrCreate(machineId: string): DaemonStateFile {
  return (
    loadDaemonState(machineId) ?? {
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
export function persistAgentPid(
  machineId: string,
  chatroomId: string,
  role: string,
  pid: number,
  tool: AgentTool
): void {
  const state = loadOrCreate(machineId);

  state.agents[agentKey(chatroomId, role)] = {
    pid,
    tool,
    startedAt: new Date().toISOString(),
  };
  state.updatedAt = new Date().toISOString();

  saveDaemonState(state);
}

/**
 * Remove a spawned agent entry from the daemon state file.
 *
 * Called after a successful agent stop or when a stale PID is detected.
 */
export function clearAgentPid(machineId: string, chatroomId: string, role: string): void {
  const state = loadDaemonState(machineId);
  if (!state) return;

  const key = agentKey(chatroomId, role);
  if (!(key in state.agents)) return;

  delete state.agents[key];
  state.updatedAt = new Date().toISOString();

  saveDaemonState(state);
}

/**
 * List all agent entries from the daemon state file.
 *
 * Returns an array of { chatroomId, role, entry } for iteration during
 * recovery. Returns an empty array when no state file exists.
 */
export function listAgentEntries(
  machineId: string
): { chatroomId: string; role: string; entry: DaemonAgentEntry }[] {
  const state = loadDaemonState(machineId);
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
