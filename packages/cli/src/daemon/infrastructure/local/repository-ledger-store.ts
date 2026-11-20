// fallow-ignore-file unused-file
/**
 * Atomic local JSON store for the machine's repository ledger.
 *
 * Writes go to a process-unique temporary file with mode 0o600, then are
 * renamed over the target (an atomic replacement on the same filesystem), so a
 * crash can never leave a half-written ledger. Reads are defensive: a missing,
 * corrupt, unknown-version or mis-shaped file reads as `null` and never throws.
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  LedgerRepository,
  ScanResult,
} from '../../../infrastructure/local-actions/scan-repositories.js';

export interface LedgerEntry extends LedgerRepository {
  discoveredAt: number;
}

export interface StoredLedger {
  version: 1;
  generatedAt: number;
  roots: string[];
  rootStatuses: ScanResult['roots'];
  truncated: boolean;
  entries: LedgerEntry[];
}

export interface RepositoryLedgerStore {
  read(): Promise<StoredLedger | null>;
  write(ledger: StoredLedger): Promise<void>;
  clear(): Promise<void>;
}

/** Shape check for reads; unknown versions and malformed documents are rejected. */
// fallow-ignore-next-line complexity
function isStoredLedger(value: unknown): value is StoredLedger {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.generatedAt === 'number' &&
    typeof candidate.truncated === 'boolean' &&
    Array.isArray(candidate.roots) &&
    Array.isArray(candidate.rootStatuses) &&
    Array.isArray(candidate.entries)
  );
}

export function createRepositoryLedgerStore(filePath: string): RepositoryLedgerStore {
  return {
    async read() {
      let contents: string;
      try {
        contents = await readFile(filePath, 'utf8');
      } catch {
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(contents);
      } catch {
        return null;
      }

      return isStoredLedger(parsed) ? parsed : null;
    },

    async write(ledger) {
      const directory = dirname(filePath);
      const temporaryPath = `${filePath}.tmp-${process.pid}`;

      await mkdir(directory, { recursive: true });

      try {
        await writeFile(temporaryPath, JSON.stringify(ledger), { mode: 0o600 });
        await rename(temporaryPath, filePath);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }

      // Overwriting an existing file keeps its old mode on some platforms, so
      // enforce the ledger's private mode after the rename.
      await chmod(filePath, 0o600);
    },

    async clear() {
      await rm(filePath, { force: true });
    },
  };
}
