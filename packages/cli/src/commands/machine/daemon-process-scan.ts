/**
 * Find leftover `machine daemon start` processes for the current Convex URL.
 *
 * The PID file only tracks one process. Local restarts with `detached: true`
 * historically left dozens of orphans (PPID 1) sharing a machine id. Start/stop
 * use this scan so every matching daemon is reaped, not just the PID-file one.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { CONVEX_URL, getConvexUrl } from '../../infrastructure/convex/client.js';

const DAEMON_START_ARGV = 'machine daemon start';

// fallow-ignore-next-line unused-export
export function commandLooksLikeDaemonStart(command: string): boolean {
  return command.includes(DAEMON_START_ARGV);
}

/**
 * True when a process environment is bound to `convexUrl`.
 * Unset `CHATROOM_CONVEX_URL` means the published default cloud URL.
 */
// fallow-ignore-next-line unused-export
export function envBlobMatchesConvexUrl(envBlob: string, convexUrl: string): boolean {
  const assigned = envBlob
    .split(/\0|\s+/)
    .find((token) => token.startsWith('CHATROOM_CONVEX_URL='));
  if (assigned !== undefined) {
    return assigned.slice('CHATROOM_CONVEX_URL='.length) === convexUrl;
  }
  return convexUrl === CONVEX_URL;
}

// fallow-ignore-next-line complexity
function parsePidCommandLine(line: string): { pid: number; command: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const splitAt = trimmed.search(/\s+/);
  if (splitAt <= 0) return null;
  const pid = Number.parseInt(trimmed.slice(0, splitAt), 10);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  return { pid, command: trimmed.slice(splitAt).trim() };
}

// fallow-ignore-next-line unused-export
export function parsePsPidCommandLines(stdout: string): { pid: number; command: string }[] {
  const result: { pid: number; command: string }[] = [];
  for (const line of stdout.split('\n')) {
    const parsed = parsePidCommandLine(line);
    if (parsed) result.push(parsed);
  }
  return result;
}

// fallow-ignore-next-line complexity
function readPpid(pid: number): number | null {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
      const closeParen = stat.lastIndexOf(')');
      const rest = closeParen >= 0 ? stat.slice(closeParen + 2).split(' ') : stat.split(' ');
      const ppid = Number.parseInt(rest[1] ?? '', 10);
      return Number.isFinite(ppid) && ppid >= 0 ? ppid : null;
    } catch {
      return null;
    }
  }
  try {
    const stdout = execFileSync('ps', ['-p', String(pid), '-o', 'ppid='], {
      encoding: 'utf-8',
      timeout: 2_000,
    });
    const ppid = Number.parseInt(stdout.trim(), 10);
    return Number.isFinite(ppid) && ppid >= 0 ? ppid : null;
  } catch {
    return null;
  }
}

// fallow-ignore-next-line complexity
function collectAncestorPids(pid = process.pid, ppid = process.ppid): Set<number> {
  const skip = new Set<number>([pid, ppid, 0, 1]);
  let current = ppid;
  for (let i = 0; i < 20 && current > 1; i++) {
    const parent = readPpid(current);
    if (parent === null || skip.has(parent)) break;
    skip.add(parent);
    current = parent;
  }
  return skip;
}

// fallow-ignore-next-line complexity
function readProcessEnvBlob(pid: number): string {
  if (process.platform === 'linux' && existsSync(`/proc/${pid}/environ`)) {
    try {
      return readFileSync(`/proc/${pid}/environ`, 'utf-8');
    } catch {
      return '';
    }
  }
  try {
    return execFileSync('ps', ['eww', '-p', String(pid), '-ww', '-o', 'command='], {
      encoding: 'utf-8',
      timeout: 2_000,
    });
  } catch {
    return '';
  }
}

function listDaemonStartProcesses(): { pid: number; command: string }[] {
  if (process.platform === 'win32') return [];
  try {
    const stdout = execFileSync('ps', ['-axo', 'pid=,command='], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    return parsePsPidCommandLines(stdout).filter((row) => commandLooksLikeDaemonStart(row.command));
  } catch {
    return [];
  }
}

/**
 * PIDs of `machine daemon start` processes bound to this process's Convex URL,
 * excluding this process and its ancestors.
 */
export function listMatchingDaemonPids(convexUrl = getConvexUrl()): number[] {
  const protectedPids = collectAncestorPids();
  const matches: number[] = [];
  for (const row of listDaemonStartProcesses()) {
    if (protectedPids.has(row.pid)) continue;
    if (!envBlobMatchesConvexUrl(readProcessEnvBlob(row.pid), convexUrl)) continue;
    matches.push(row.pid);
  }
  return matches;
}
