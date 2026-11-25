/**
 * Chatroom transfer file I/O — the export file name and the atomic publish.
 *
 * `writeExportFileAtomically` publishes with `link`, not `rename`: a rename
 * silently replaces an existing file, while `link` fails with `EEXIST`. That
 * gives "never overwrite an export" at the filesystem level instead of a
 * check-then-write race.
 *
 * Sequence: create the directory (`0o700`), write a hidden temp file with flag
 * `wx` and mode `0o600`, hard-link the temp to the final name, then unlink the
 * temp. Every failure before the link removes the temp (except when the
 * exclusive create itself reported `EEXIST`: that path belongs to another
 * writer and must be left alone). A cleanup failure after a successful link is
 * ignored — the export exists, so reporting failure would be a lie.
 *
 * POSIX mode bits are the owner-only guarantee; Windows ignores them, and the
 * file is then protected only by the containing directory's ACLs.
 *
 * Some filesystems (FAT, some network mounts, some sandboxes) have no hard
 * links and report `EPERM`/`ENOTSUP` from `link`; that surfaces as
 * `EXPORT_PUBLISH_UNSUPPORTED`, never as a raw errno.
 */

import * as fsp from 'node:fs/promises';
import { join } from 'node:path';

import {
  ChatroomTransferError,
  TRANSFER_ERROR_CODES,
} from '@workspace/backend/src/domain/entities/chatroom-transfer-file';

import type { ChatroomTransferFs } from './deps.js';

/** Directories the export creates are private to the owner. */
const DIRECTORY_MODE = 0o700;
/** The exported file itself is private to the owner. */
const FILE_MODE = 0o600;
/** The `.gitignore` written into a default exports directory. */
const EXPORTS_GITIGNORE = '*\n';
/** Readable by everyone, so git and tools can read it; it holds no secret. */
const IGNORE_FILE_MODE = 0o644;

/** `chatroom-<id>-YYYYMMDDTHHMMSSZ.json`, UTC with no colons (Windows-safe). */
export function exportFileName(chatroomId: string, at: Date): string {
  const stamp = at.toISOString().slice(0, 19).replace(/[-:]/g, '');
  return `chatroom-${chatroomId}-${stamp}Z.json`;
}

/**
 * Prepares the default exports directory: creates it, then writes a `.gitignore`
 * containing `*` when none exists. An existing `.gitignore` is never replaced.
 */
export async function prepareDefaultExportsDir(fs: ChatroomTransferFs, dir: string): Promise<void> {
  await fs.mkdirp(dir, DIRECTORY_MODE);
  try {
    await fs.writeExclusive(join(dir, '.gitignore'), EXPORTS_GITIGNORE, IGNORE_FILE_MODE);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
}

/**
 * Writes `json` to `<dir>/<name>` without ever replacing an existing file.
 *
 * @returns the absolute final path.
 * @throws ChatroomTransferError `EXPORT_FILE_EXISTS` when the final name is taken.
 * @throws ChatroomTransferError `EXPORT_PUBLISH_UNSUPPORTED` when the filesystem
 * cannot hard-link, so the export cannot be published without overwriting.
 */
export async function writeExportFileAtomically(
  fs: ChatroomTransferFs,
  dir: string,
  name: string,
  json: string
): Promise<string> {
  await fs.mkdirp(dir, DIRECTORY_MODE);

  const final = join(dir, name);
  const tmp = join(dir, `.${name}.${process.pid}.tmp`);

  await writeTempFile(fs, tmp, json);
  try {
    await publish(fs, tmp, final);
  } catch (error) {
    await discard(fs, tmp);
    throw error;
  }

  // The hard link is the export. A leftover temp name is cosmetic, so a failed
  // cleanup never turns a published export into a reported failure.
  await discard(fs, tmp);
  return final;
}

/** Creates the temp file. A failed exclusive create never owned the path when another writer did. */
async function writeTempFile(fs: ChatroomTransferFs, tmp: string, json: string): Promise<void> {
  try {
    await fs.writeExclusive(tmp, json, FILE_MODE);
  } catch (error) {
    if (!isAlreadyExists(error)) await discard(fs, tmp);
    throw error;
  }
}

/**
 * Hard-links the temp name to the final name, mapping a name clash or an
 * unsupported link to a transfer error.
 *
 * @throws ChatroomTransferError `EXPORT_FILE_EXISTS` when the final name is
 * taken, `EXPORT_PUBLISH_UNSUPPORTED` when the filesystem has no hard links.
 */
async function publish(fs: ChatroomTransferFs, tmp: string, final: string): Promise<void> {
  try {
    await fs.link(tmp, final);
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new ChatroomTransferError(
        TRANSFER_ERROR_CODES.EXPORT_FILE_EXISTS,
        `file already exists: ${final}; choose another --path or wait a second`
      );
    }
    if (isLinkUnsupported(error)) {
      throw new ChatroomTransferError(
        TRANSFER_ERROR_CODES.EXPORT_PUBLISH_UNSUPPORTED,
        `this filesystem cannot publish an export without overwriting it (${String(codeOf(error))}); choose another --path`
      );
    }
    throw error;
  }
}

/** Best-effort removal: a temp name that is already gone is not an anomaly. */
async function discard(fs: ChatroomTransferFs, path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch {
    // Ignore: the only caller is a cleanup path, and the export already exists
    // (or never did) either way.
  }
}

/** True for the `EEXIST` errno that a `link` or an exclusive create reports. */
function isAlreadyExists(error: unknown): boolean {
  return codeOf(error) === 'EEXIST';
}

/** True for the errnos a filesystem without hard links reports from `link`. */
function isLinkUnsupported(error: unknown): boolean {
  const code = codeOf(error);
  return code === 'EPERM' || code === 'ENOTSUP';
}

/** The errno `code` of a thrown value, or `undefined`. */
function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
}

/** The production adapter over `node:fs/promises`. */
export function createNodeChatroomTransferFs(): ChatroomTransferFs {
  return {
    mkdirp: async (path, mode) => {
      await fsp.mkdir(path, { recursive: true, mode });
    },
    writeExclusive: async (path, data, mode) => {
      const handle = await fsp.open(path, 'wx', mode);
      try {
        await handle.writeFile(data, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    link: (existing, newPath) => fsp.link(existing, newPath),
    unlink: (path) => fsp.unlink(path),
    readFile: (path) => fsp.readFile(path, 'utf8'),
    stat: async (path) => {
      const stats = await fsp.stat(path);
      return { isFile: stats.isFile(), isDirectory: stats.isDirectory(), size: stats.size };
    },
  };
}
