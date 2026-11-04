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
 * - A write that would exceed the cap first drops names the machine's current
 *   sources no longer define, so deleting agents cannot permanently wedge the
 *   store. If pruning cannot help it fails with a message naming the file.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { validateCustomAgentName } from '@workspace/shared/domain/custom-agent';

import { errorCode } from '../../../infrastructure/services/custom-agents/safe-read.js';

const STATE_VERSION = 1;
/** Hard cap on stored names. Far above the per-source agent limit. */
const MAX_DISABLED_ENTRIES = 256;

export interface DisabledStateStore {
  read(): Promise<ReadonlySet<string>>;
  /**
   * Persists `names`. `knownNames` is every agent name the machine's current
   * sources define; names outside it are stale and are dropped when the cap is
   * about to be exceeded.
   */
  write(names: ReadonlySet<string>, knownNames: ReadonlySet<string>): Promise<void>;
}

function log(message: string): void {
  console.warn(`[custom-agents-state] ${message}`);
}

/** A file-backed store. `filePath` is the whole file, not a directory. */
export function createFileDisabledStateStore(filePath: string): DisabledStateStore {
  return {
    read: () => readState(filePath),
    write: (names, knownNames) => writeState(filePath, names, knownNames),
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

/**
 * Drops names the machine's current sources no longer define. An empty
 * `knownNames` means nothing has loaded yet, and pruning then would erase every
 * flag, so the names are kept and the cap check decides.
 */
function pruneToKnownSources(
  names: ReadonlySet<string>,
  knownNames: ReadonlySet<string>
): ReadonlySet<string> {
  if (knownNames.size === 0) return names;
  return new Set([...names].filter((name) => knownNames.has(name)));
}

async function writeState(
  filePath: string,
  names: ReadonlySet<string>,
  knownNames: ReadonlySet<string>
): Promise<void> {
  const persisted =
    names.size > MAX_DISABLED_ENTRIES ? pruneToKnownSources(names, knownNames) : names;
  if (persisted.size > MAX_DISABLED_ENTRIES) {
    throw new Error(
      `Refusing to persist ${persisted.size} disabled custom agents (max ${MAX_DISABLED_ENTRIES}) ` +
        `even after pruning names no source defines; delete stale entries from ${filePath}`
    );
  }
  const sorted = [...persisted].sort();
  const payload = `${JSON.stringify({ version: STATE_VERSION, disabled: sorted }, null, 2)}\n`;
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tmpPath, payload, 'utf8');
  await rename(tmpPath, filePath);
}
