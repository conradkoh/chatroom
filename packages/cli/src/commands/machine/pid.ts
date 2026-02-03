/**
 * PID File Management
 *
 * Manages the daemon PID file to prevent multiple instances
 * and enable clean shutdown.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHATROOM_DIR = join(homedir(), '.chatroom');
const PID_FILE = 'daemon.pid';

/**
 * Get the path to the PID file
 */
export function getPidFilePath(): string {
  return join(CHATROOM_DIR, PID_FILE);
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

/**
 * Acquire the daemon lock (write PID file)
 *
 * @returns true if lock acquired, false if daemon already running
 */
export function acquireLock(): boolean {
  const { running, pid } = isDaemonRunning();

  if (running) {
    console.error(`❌ Daemon already running (PID: ${pid})`);
    return false;
  }

  writePid();
  return true;
}

/**
 * Release the daemon lock (remove PID file)
 */
export function releaseLock(): void {
  removePid();
}
