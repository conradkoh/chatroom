/**
 * Orphan Process Group Tracker
 *
 * When the daemon spawns commands with `detached: true`, each child becomes the
 * leader of its own process group. Graceful shutdown reaps them via
 * `shutdownAllCommands` → `killProcess(-pid, signal)`. The gap is an ungraceful
 * exit (SIGKILL, OOM, panic) where no JS cleanup runs and the children become
 * orphans reparented to PID 1, holding ports like 8081.
 *
 * This module persists PGIDs (== child PIDs from `spawn`) to a file on disk.
 * On every spawn: append. On every clean exit: remove. On daemon startup: reap
 * any survivors left over from a previous crashed run.
 *
 * File: ~/.chatroom/daemon-children-<urlHash>.pids
 * Format: newline-delimited positive integers. Unparseable lines are silently
 * ignored on read to survive partial writes.
 */

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';

import { getConvexUrl } from '../../../../infrastructure/convex/client.js';

// ─── File Paths ──────────────────────────────────────────────────────────────

function getUrlHash(): string {
  const url = getConvexUrl();
  return createHash('sha256').update(url).digest('hex').substring(0, 8);
}

/** Exported for tests to override via HOME env manipulation. */
// fallow-ignore-next-line unused-export
export function getChildPidsFilePath(): string {
  const dir = join(homedir(), '.chatroom');
  return join(dir, `daemon-children-${getUrlHash()}.pids`);
}

function ensureChatroomDir(): void {
  const dir = join(homedir(), '.chatroom');
  if (!existsSync(dir)) {
    // SECURITY: 0o700 restricts directory access to owner only.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

// ─── Read / Write helpers ────────────────────────────────────────────────────

/** Read all valid PGIDs from the pids file. Returns [] if file is missing. */
function readPids(): number[] {
  const filePath = getChildPidsFilePath();
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, 'utf-8')
      .split('\n')
      .map((line) => parseInt(line.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Append a PGID to the pids file. Called immediately after a successful spawn.
 * Swallows errors (with a console.warn) — tracking is best-effort; the daemon
 * must not crash because it couldn't write to a pids file.
 */
export function trackChildPid(pid: number): void {
  try {
    ensureChatroomDir();
    appendFileSync(getChildPidsFilePath(), `${pid}\n`, 'utf-8');
  } catch (err) {
    console.warn(`[orphan-tracker] Failed to track child PID ${pid}: ${err}`);
  }
}

/**
 * Remove a PGID from the pids file. Called when the process exits cleanly.
 * Uses a write-to-tmp-then-rename pattern for atomicity.
 * Swallows errors (with a console.warn).
 */
export function untrackChildPid(pid: number): void {
  try {
    const filePath = getChildPidsFilePath();
    if (!existsSync(filePath)) return;
    const remaining = readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter((line) => {
        const n = parseInt(line.trim(), 10);
        return Number.isFinite(n) && n > 0 && n !== pid;
      });
    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, remaining.join('\n') + (remaining.length > 0 ? '\n' : ''), 'utf-8');
    renameSync(tmpPath, filePath);
  } catch (err) {
    console.warn(`[orphan-tracker] Failed to untrack child PID ${pid}: ${err}`);
  }
}

/**
 * Remove the pids file entirely. Called after graceful shutdown so the next
 * daemon start finds nothing to reap.
 * Swallows ENOENT silently.
 */
export function clearTrackedPids(): void {
  try {
    const filePath = getChildPidsFilePath();
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Ignore — file may already be gone
  }
}

/**
 * Synchronously SIGKILL every tracked process group, best-effort.
 *
 * Used by the force-exit path (e.g. second Ctrl+C) where we cannot afford to
 * await anything — we must kill children and exit immediately. Reads PGIDs
 * straight from the on-disk pids file so it works even if in-memory state is
 * already torn down or inconsistent.
 *
 * Never throws. Returns the number of groups we attempted to kill.
 */
// fallow-ignore-next-line unused-export
export function forceKillAllTrackedProcessGroups(): number {
  if (process.platform === 'win32') return 0;
  let killed = 0;
  for (const pgid of readPids()) {
    try {
      process.kill(-pgid, 'SIGKILL');
      killed++;
    } catch {
      // Already gone — best-effort
    }
  }
  return killed;
}

/**
 * Reap orphaned process groups left over from a previous daemon run.
 *
 * For each persisted PGID:
 *   1. Skip on win32 (process groups work differently).
 *   2. Probe with `process.kill(-pgid, 0)`. If it throws (ESRCH), the group
 *      is already gone — count as checked but not reaped.
 *   3. Otherwise send SIGTERM to the group. Poll up to 500ms; escalate to
 *      SIGKILL if the group is still alive.
 *
 * Clears the pids file when done.
 * Returns `{ reaped, checked }` for logging at the call site.
 */
// fallow-ignore-next-line unused-export
export async function reapOrphanedProcessGroups(): Promise<{
  reaped: number;
  checked: number;
}> {
  const pids = readPids();
  let reaped = 0;
  const checked = pids.length;

  for (const pgid of pids) {
    if (process.platform === 'win32') continue;

    // Probe: is the group still alive?
    try {
      process.kill(-pgid, 0);
    } catch {
      // ESRCH — already gone
      continue;
    }

    // Send SIGTERM to the entire process group
    try {
      process.kill(-pgid, 'SIGTERM');
    } catch {
      continue; // Died between probe and kill — that's fine
    }

    // Poll up to 500ms for graceful exit
    const deadline = Date.now() + 500;
    let alive = true;
    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 50));
      try {
        process.kill(-pgid, 0);
      } catch {
        alive = false;
        break;
      }
    }

    // Escalate to SIGKILL if still alive
    if (alive) {
      try {
        process.kill(-pgid, 'SIGKILL');
      } catch {
        // May have exited between last probe and SIGKILL
      }
    }

    console.log(`[orphan-tracker] Reaped orphan process group ${pgid}`);
    reaped++;
  }

  clearTrackedPids();
  return { reaped, checked };
}

// ── Effect twins ──────────────────────────────────────────────────────────────

/** Effect twin — wraps reapOrphanedProcessGroups (no service deps needed). */
export const reapOrphanedProcessGroupsEffect: Effect.Effect<{ reaped: number; checked: number }> =
  Effect.promise(() => reapOrphanedProcessGroups());

/** Effect twin — wraps forceKillAllTrackedProcessGroups (no service deps needed). */
export const forceKillAllTrackedProcessGroupsEffect: Effect.Effect<number> = Effect.sync(() =>
  forceKillAllTrackedProcessGroups()
);

/** Effect twin — wraps clearTrackedPids (no service deps needed). */
// fallow-ignore-next-line unused-export
export const clearTrackedPidsEffect: Effect.Effect<void> = Effect.sync(() => clearTrackedPids());
