/**
 * PID File Management
 *
 * Manages the daemon PID file to prevent multiple instances
 * and enable clean shutdown.
 *
 * PID files are scoped per Convex URL so that multiple daemons
 * can run simultaneously for different environments.
 * File naming: daemon-<urlHash>.pid (e.g., daemon-a1b2c3d4.pid)
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { getConvexUrl } from '../../infrastructure/convex/client.js';

const CHATROOM_DIR = join(homedir(), '.chatroom');

/**
 * Generate a short hash of the Convex URL for PID file scoping.
 * Uses first 8 chars of SHA-256 hex digest for uniqueness without excessive length.
 */
function getUrlHash(): string {
  const url = getConvexUrl();
  return createHash('sha256').update(url).digest('hex').substring(0, 8);
}

/**
 * Get the PID filename scoped to the current Convex URL.
 */
function getPidFileName(): string {
  return `daemon-${getUrlHash()}.pid`;
}

/**
 * Ensure the chatroom directory exists
 */
function ensureChatroomDir(): void {
  if (!existsSync(CHATROOM_DIR)) {
    // SECURITY: 0o700 restricts directory access to owner only.
    mkdirSync(CHATROOM_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Get the path to the PID file for the current Convex URL
 */
export function getPidFilePath(): string {
  return join(CHATROOM_DIR, getPidFileName());
}

/**
 * Check if a process with the given PID is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Signal 0 doesn't actually send a signal, just checks if process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the PID from the file
 *
 * @returns PID if file exists and is valid, null otherwise
 */
export function readPid(): number | null {
  const pidPath = getPidFilePath();

  if (!existsSync(pidPath)) {
    return null;
  }

  try {
    const content = readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(content, 10);

    if (isNaN(pid) || pid <= 0) {
      return null;
    }

    return pid;
  } catch {
    return null;
  }
}

/**
 * Write the current process PID to the file
 */
export function writePid(): void {
  ensureChatroomDir();
  const pidPath = getPidFilePath();
  writeFileSync(pidPath, process.pid.toString(), 'utf-8');
}

/**
 * Remove the PID file
 */
export function removePid(): void {
  const pidPath = getPidFilePath();

  try {
    if (existsSync(pidPath)) {
      unlinkSync(pidPath);
    }
  } catch {
    // Ignore errors - file might already be removed
  }
}

/**
 * Check if daemon is currently running
 *
 * @returns Object with running status and PID if running
 */
export function isDaemonRunning(): { running: boolean; pid: number | null } {
  const pid = readPid();

  if (pid === null) {
    return { running: false, pid: null };
  }

  if (isProcessRunning(pid)) {
    return { running: true, pid };
  }

  // Stale PID file - process is not running
  // Clean it up
  removePid();
  return { running: false, pid: null };
}

/** Default interval between lock acquisition retries during daemon restart. */
const LOCK_RETRY_INTERVAL_MS = 500;

/** Max time to wait for a previous daemon instance to release the lock on restart. */
const LOCK_RETRY_MAX_WAIT_MS = 15_000;

/**
 * Attempt to acquire the daemon lock without logging.
 */
function tryAcquireLock(): boolean {
  const { running } = isDaemonRunning();

  if (running) {
    return false;
  }

  writePid();
  return true;
}

function logWaitingForShutdown(pid: number): void {
  console.error(
    `⏳ Waiting for previous daemon to shut down for ${getConvexUrl()} (PID: ${pid})...`
  );
}

function logDaemonAlreadyRunning(pid: number | null): void {
  console.error(`❌ Daemon already running for ${getConvexUrl()} (PID: ${pid})`);
}

// fallow-ignore-next-line complexity
async function waitForLockOrTimeout(
  deadline: number,
  intervalMs: number,
  sleep: (ms: number) => Promise<void>
): Promise<boolean> {
  let loggedWait = false;

  while (Date.now() < deadline) {
    if (tryAcquireLock()) {
      return true;
    }

    const { pid } = isDaemonRunning();
    if (pid !== null && !loggedWait) {
      logWaitingForShutdown(pid);
      loggedWait = true;
    }

    await sleep(intervalMs);
  }

  return false;
}

/**
 * Acquire the daemon lock, retrying while a previous instance shuts down.
 *
 * On PM2/process-manager restart the old daemon may still hold the PID file
 * briefly. Retrying avoids a burst of duplicate "already running" errors.
 *
 * @returns true if lock acquired, false if still held after max wait
 */
// fallow-ignore-next-line complexity
export async function acquireLockWithRetry(options?: {
  intervalMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  const intervalMs = options?.intervalMs ?? LOCK_RETRY_INTERVAL_MS;
  const maxWaitMs = options?.maxWaitMs ?? LOCK_RETRY_MAX_WAIT_MS;
  const sleep =
    options?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + maxWaitMs;

  if (await waitForLockOrTimeout(deadline, intervalMs, sleep)) {
    return true;
  }

  const { pid } = isDaemonRunning();
  logDaemonAlreadyRunning(pid);
  return false;
}

/**
 * Release the daemon lock (remove PID file)
 */
export function releaseLock(): void {
  removePid();
}
