/**
 * Shared Route Utilities
 *
 * Common helpers used by local API route handlers that accept a
 * `{ workingDir: string }` JSON body, validate the path, and shell out.
 *
 * Extracted from open-finder, open-vscode, and open-github-desktop routes
 * to eliminate duplication.
 */

import { exec } from 'node:child_process';
import { access } from 'node:fs/promises';

import type { LocalApiRequest, LocalApiResponse } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Discriminated result from {@link parseWorkingDir}. */
export type ParseResult =
  | { ok: true; workingDir: string }
  | { ok: false; response: LocalApiResponse };

// ─── JSON Response Helper ─────────────────────────────────────────────────────

/**
 * Build a JSON {@link LocalApiResponse}.
 */
export function jsonResponse(status: number, body: Record<string, unknown>): LocalApiResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ─── Body Parsing & Validation ────────────────────────────────────────────────

/**
 * Parse the request body as JSON, extract and validate `workingDir`,
 * and verify the directory exists on disk.
 *
 * Returns either the validated `workingDir` string or a ready-to-send
 * error response — callers can return it directly.
 */
export async function parseWorkingDir(req: LocalApiRequest): Promise<ParseResult> {
  // Parse JSON body
  let body: { workingDir?: string } = {};
  try {
    if (req.body) {
      body = JSON.parse(req.body) as { workingDir?: string };
    }
  } catch {
    return { ok: false, response: jsonResponse(400, { success: false, error: 'Invalid JSON body' }) };
  }

  const { workingDir } = body;

  // Validate workingDir
  if (!workingDir || typeof workingDir !== 'string' || workingDir.trim() === '') {
    return { ok: false, response: jsonResponse(400, { success: false, error: 'workingDir is required' }) };
  }

  // Verify path exists
  try {
    await access(workingDir);
  } catch {
    return {
      ok: false,
      response: jsonResponse(400, { success: false, error: `Directory not found: ${workingDir}` }),
    };
  }

  return { ok: true, workingDir };
}

// ─── Shell Helpers ────────────────────────────────────────────────────────────

/**
 * Escape a filesystem path for safe use as a shell argument.
 * Wraps the path in double quotes and escapes any embedded double quotes.
 */
export function escapeShellArg(arg: string): string {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * Resolve the platform-specific command used to locate an executable.
 * - POSIX: `which <name>`
 * - Windows: `where <name>`
 */
export function resolveWhichCommand(name: string): string {
  return process.platform === 'win32' ? `where ${name}` : `which ${name}`;
}

/**
 * Check whether a CLI command is available on PATH.
 * Resolves to `true` if found, `false` otherwise.
 */
export function isCliAvailable(cliName: string): Promise<boolean> {
  return new Promise((resolve) => {
    exec(resolveWhichCommand(cliName), (err) => {
      resolve(!err);
    });
  });
}

/**
 * Fire-and-forget: execute a shell command and log errors without propagating.
 */
export function execFireAndForget(command: string, logTag: string): void {
  exec(command, (err) => {
    if (err) {
      console.warn(`[${logTag}] exec failed: ${err.message}`);
    }
  });
}
