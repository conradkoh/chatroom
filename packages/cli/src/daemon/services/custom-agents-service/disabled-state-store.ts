// fallow-ignore-file unused-file
/**
 * Machine-local custom-agent disable state.
 *
 * The daemon owns this file: disable is a machine-local preference, never a
 * Convex row. The file is `{ version: 1, disabled: string[] }`.
 *
 * Constraints:
 * - Reading never throws. A missing file is an empty set; a corrupt file, an
 *   unknown version, or a failed read is an empty set plus one log line.
 * - Invalid names are dropped on read, so a hand-edited file cannot smuggle a
 *   name that the shared validator would reject.
 * - Writing validates the 256-entry cap, creates the parent directory, and is
 *   atomic (temp file in the same directory, then rename). The service's serial
 *   queue guarantees two writes never interleave.
 *
 * Temporary marker: S3c wires this into the daemon and removes the suppression.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { validateCustomAgentName } from '@workspace/shared/domain/custom-agent';

const STATE_VERSION = 1;
/** Hard cap on stored names. Far above the per-source agent limit. */
const MAX_DISABLED_ENTRIES = 256;

export interface DisabledStateStore {
  read(): Promise<ReadonlySet<string>>;
  write(names: ReadonlySet<string>): Promise<void>;
}

function log(message: string): void {
  console.warn(`[custom-agents-state] ${message}`);
}

/** A file-backed store. `filePath` is the whole file, not a directory. */
export function createFileDisabledStateStore(filePath: string): DisabledStateStore {
  return {
    read: () => readState(filePath),
    write: (names) => writeState(filePath, names),
  };
}

async function readState(filePath: string): Promise<ReadonlySet<string>> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (!isMissingFile(error)) log(`read failed (${errorCode(error)}), using an empty set`);
    return new Set();
  }
  return parseState(raw) ?? new Set();
}

function isMissingFile(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === 'string' ? code : 'io';
}

/** Returns null when the payload cannot be trusted; the caller falls back to empty. */
function parseState(raw: string): ReadonlySet<string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log('invalid JSON, using an empty set');
    return null;
  }
  if (!isStateShape(parsed)) {
    log(`unsupported shape or version, using an empty set`);
    return null;
  }
  return toNameSet(parsed.disabled);
}

function isStateShape(value: unknown): value is { version: number; disabled: unknown[] } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { version?: unknown; disabled?: unknown };
  return candidate.version === STATE_VERSION && Array.isArray(candidate.disabled);
}

function toNameSet(names: readonly unknown[]): ReadonlySet<string> {
  const valid = names
    .filter(
      (name): name is string => typeof name === 'string' && validateCustomAgentName(name) === null
    )
    .slice(0, MAX_DISABLED_ENTRIES);
  return new Set(valid);
}

async function writeState(filePath: string, names: ReadonlySet<string>): Promise<void> {
  if (names.size > MAX_DISABLED_ENTRIES) {
    throw new Error(
      `Refusing to persist ${names.size} disabled custom agents (max ${MAX_DISABLED_ENTRIES})`
    );
  }
  const sorted = [...names].sort();
  const payload = `${JSON.stringify({ version: STATE_VERSION, disabled: sorted }, null, 2)}\n`;
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tmpPath, payload, 'utf8');
  await rename(tmpPath, filePath);
}
