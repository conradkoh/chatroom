/**
 * Bounded, symlink-safe text reader for the custom-agent loader.
 *
 * Contract, in order:
 * - `lstat` first. A symlink or a non-regular file is never opened.
 * - Open with `O_NOFOLLOW` when the platform defines it, then `fstat` the
 *   handle, so a swap between `lstat` and `open` cannot turn the read into a
 *   symlink follow.
 * - A file larger than `maxBytes` is rejected from its `fstat` size, before any
 *   content is read. The read itself is capped at `maxBytes + 1` so a racing
 *   append is still caught.
 * - Decode strictly as UTF-8, strip a leading BOM, and normalise CRLF to LF.
 *
 * Failures carry an errno `code` (or the generic `io` marker) and the file name
 * at most. Neither an absolute path nor the underlying `Error.message` ever
 * reaches an issue, so a snapshot cannot leak local directory layout.
 */

import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { lstat, open } from 'node:fs/promises';
import { basename } from 'node:path';

export type SafeReadResult =
  { ok: true; text: string } | { ok: false; reason: 'unreadable' | 'too-large'; detail: string };

export type SafeReadFailure = Extract<SafeReadResult, { ok: false }>;

/** `undefined` on platforms without `O_NOFOLLOW`, where the flag is omitted. */
const NO_FOLLOW_FLAG = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW;

/** Maximum bytes read from one file. A cap of 0 still reads at most one byte. */
export async function safeReadTextFile(absPath: string, maxBytes: number): Promise<SafeReadResult> {
  const inspected = await inspectPath(absPath);
  if (!inspected.ok) return inspected;
  return await readRegularFile(absPath, maxBytes);
}

/** Rejects symlinks and non-regular files without opening them. */
async function inspectPath(absPath: string): Promise<{ ok: true } | SafeReadFailure> {
  try {
    const stats = await lstat(absPath);
    if (stats.isSymbolicLink()) return failure('unreadable', 'symlink');
    if (!stats.isFile()) return failure('unreadable', 'not-regular');
    return { ok: true };
  } catch (err) {
    return failure('unreadable', errorCode(err));
  }
}

async function readRegularFile(absPath: string, maxBytes: number): Promise<SafeReadResult> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(absPath, openFlags());
    return await readHandle(handle, maxBytes, basename(absPath));
  } catch (err) {
    return failure('unreadable', errorCode(err));
  } finally {
    await closeQuietly(handle);
  }
}

async function readHandle(
  handle: FileHandle,
  maxBytes: number,
  fileName: string
): Promise<SafeReadResult> {
  const stats = await handle.stat();
  if (!stats.isFile()) return failure('unreadable', 'not-regular');
  if (stats.size > maxBytes) return failure('too-large', fileName);

  const buffer = Buffer.alloc(maxBytes + 1);
  const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
  if (bytesRead > maxBytes) return failure('too-large', fileName);
  return decodeUtf8(buffer.subarray(0, bytesRead));
}

/** A close failure cannot change the bytes already read, so it is swallowed. */
async function closeQuietly(handle: FileHandle | undefined): Promise<void> {
  try {
    await handle?.close();
  } catch {
    // Nothing to report: the read already produced its result.
  }
}

function decodeUtf8(bytes: Uint8Array): SafeReadResult {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, text: normalizeText(text) };
  } catch {
    return failure('unreadable', 'encoding');
  }
}

function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function openFlags(): number {
  return NO_FOLLOW_FLAG === undefined ? constants.O_RDONLY : constants.O_RDONLY | NO_FOLLOW_FLAG;
}

function failure(reason: SafeReadFailure['reason'], detail: string): SafeReadFailure {
  return { ok: false, reason, detail };
}

/** The errno code when the error carries one, otherwise the generic `io` marker. */
export function errorCode(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === 'string' ? code : 'io';
}
