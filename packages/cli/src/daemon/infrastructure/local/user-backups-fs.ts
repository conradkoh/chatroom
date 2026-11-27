/**
 * Local filesystem and HTTP adapter for machine backups.
 *
 * The only place that touches `node:fs` and `fetch` for backups. Symlinks are never followed
 * (`lstat`), a missing directory is never created, and the uploaded bytes are hashed while they
 * stream so the reported digest always describes exactly what was sent.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';

import { BACKUP_UPLOAD_CONTENT_TYPE } from '@workspace/shared/domain/machine-backup';

import type { DirFile, FileStat } from '../../domain/usecase/machine-backup-service.js';

/** lstat: a symlink reports `isSymlink: true` and is never followed. */
export async function statBackupFile(path: string): Promise<FileStat> {
  const s = await lstat(path);
  return { isFile: s.isFile(), isSymlink: s.isSymbolicLink(), size: s.size, mtimeMs: s.mtimeMs };
}

/** Entries of `dir` with lstat data. Rejects ENOENT for a missing directory (the service handles it). */
export async function listBackupDir(dir: string): Promise<DirFile[]> {
  const names = await readdir(dir);
  const files = await Promise.all(
    names.map(async (name) => {
      try {
        return { name, ...(await statBackupFile(join(dir, name))) };
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') return null; // vanished mid-listing
        throw error;
      }
    })
  );
  return files.filter((f): f is DirFile => f !== null);
}

/**
 * Streams `path` as the POST body while hashing it. Resolves with the storage id from the response
 * and the lowercase hex SHA-256 of the bytes streamed. Throws when the bytes sent differ from
 * `sizeBytes` or the response is not ok or has no string `storageId`.
 */
export async function uploadBackupFile(args: {
  path: string;
  uploadUrl: string;
  sizeBytes: number;
}): Promise<{ storageId: string; sha256: string }> {
  const hash = createHash('sha256');
  let streamed = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      streamed += chunk.length;
      callback(null, chunk);
    },
  });
  const file = createReadStream(args.path);
  const source = file.pipe(tap);
  try {
    const response = await fetch(args.uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': BACKUP_UPLOAD_CONTENT_TYPE,
        'Content-Length': String(args.sizeBytes),
      },
      body: Readable.toWeb(source) as unknown as ReadableStream,
      duplex: 'half',
    } as RequestInit);
    if (!response.ok) throw new Error(`Upload failed with status ${response.status}`);
    if (streamed !== args.sizeBytes) throw new Error('Backup size changed while uploading');
    const body = (await response.json()) as { storageId?: unknown };
    if (typeof body.storageId !== 'string') throw new Error('Upload response has no storageId');
    return { storageId: body.storageId, sha256: hash.digest('hex') };
  } finally {
    file.destroy();
  }
}
