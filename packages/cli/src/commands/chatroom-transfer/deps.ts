/**
 * Chatroom transfer deps — dependency interfaces for `chatroom export`/`import`.
 *
 * The command layer never touches `node:fs`, `process.cwd()` or `console`
 * directly. Everything observable goes through one of the ports below, so the
 * tests substitute at the boundary the brief names and the real drivers still
 * run.
 */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

/**
 * File system operations used to publish an export file.
 *
 * Modes are passed at create time because `chmod` is not part of the port: an
 * export must be owner-readable only from the first byte written, never after
 * a widening step. `link` is the publish primitive — unlike `rename` it fails
 * with `EEXIST` instead of silently overwriting.
 */
export interface ChatroomTransferFs {
  /** Create the directory and its parents, applying `mode` to directories it creates. */
  mkdirp: (path: string, mode: number) => Promise<void>;
  /** Open with flag `wx` (fail if the path exists), write UTF-8, fsync, close. */
  writeExclusive: (path: string, data: string, mode: number) => Promise<void>;
  /** Hard-link `existing` to `newPath`; fails with code `EEXIST` when `newPath` exists. */
  link: (existing: string, newPath: string) => Promise<void>;
  /** Remove one path; rejects when it does not exist. */
  unlink: (path: string) => Promise<void>;
  /** Read a whole file as UTF-8. */
  readFile: (path: string) => Promise<string>;
  /** Stat one path; never returns a symlink-specific kind. */
  stat: (path: string) => Promise<{ isFile: boolean; isDirectory: boolean; size: number }>;
}

/**
 * OS signal registration for the import write phase.
 *
 * Injected so a test can fire a signal and assert the listeners are removed
 * afterwards; production binds `process.on`/`process.off`.
 */
export interface TransferSignals {
  on: (signal: 'SIGINT' | 'SIGTERM', handler: () => void) => void;
  off: (signal: 'SIGINT' | 'SIGTERM', handler: () => void) => void;
}

/** Every dependency an export or import command needs, including its output channels. */
export interface ChatroomTransferDeps {
  backend: BackendOps;
  session: SessionOps;
  machine: { getMachineId: () => Promise<string | null> };
  fs: ChatroomTransferFs;
  clock: () => Date;
  version: string;
  cwd: () => string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Exit with a status code; injected so a failure path is assertable under test. */
  exit: (code: number) => void;
  /** SIGINT/SIGTERM registration for the import write phase. */
  signals: TransferSignals;
}
