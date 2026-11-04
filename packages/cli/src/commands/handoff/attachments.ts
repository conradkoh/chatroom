/**
 * Handoff file attachments — local validation and the upload loop.
 *
 * Validation is entirely local and runs before any network call. Bytes are
 * read just before each upload and sent straight to the upload URL returned by
 * `beginUpload`; the CLI never reads a blob URL back.
 */

import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

import {
  FILE_ATTACHMENT_MAX_BYTES,
  FILE_ATTACHMENT_MAX_PER_HANDOFF,
  isValidAttachmentFilename,
  resolveFileAttachmentType,
  type FileAttachmentMimeType,
} from '@workspace/shared/domain/file-attachment';
import { Effect } from 'effect';

import type { FileAttachmentUploaderOps } from './deps.js';
import { FileAttachmentUploadError } from './deps.js';
import type { HandoffError } from './index.js';

/** A validated attachment, ready to upload. */
export type PreparedAttachment = {
  path: string;
  filename: string;
  sizeBytes: number;
  mimeType: FileAttachmentMimeType;
};

function attachmentInvalid(path: string, reason: string): HandoffError {
  return { _tag: 'AttachmentInvalid', path, reason };
}

function uploadFailed(filename: string, cause: unknown): HandoffError {
  if (cause instanceof FileAttachmentUploadError) {
    return {
      _tag: 'AttachmentUploadFailed',
      filename,
      code: cause.code,
      message: cause.message,
    };
  }
  return {
    _tag: 'AttachmentUploadFailed',
    filename,
    code: 'UPLOAD_FAILED',
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

/** Enforces existence, non-empty, and size rules for one path. */
function validateFileStats(
  path: string,
  stats: { isFile(): boolean; size: number }
): Effect.Effect<void, HandoffError> {
  if (!stats.isFile()) {
    return Effect.fail(attachmentInvalid(path, 'not a regular file'));
  }
  if (stats.size <= 0) {
    return Effect.fail(attachmentInvalid(path, 'file is empty'));
  }
  if (stats.size > FILE_ATTACHMENT_MAX_BYTES) {
    return Effect.fail(
      attachmentInvalid(path, `file exceeds the ${FILE_ATTACHMENT_MAX_BYTES}-byte limit`)
    );
  }
  return Effect.void;
}

/** Resolves the allowlisted MIME type and validates the basename. */
function resolveAttachmentType(
  path: string,
  filename: string
): Effect.Effect<FileAttachmentMimeType, HandoffError> {
  const type = resolveFileAttachmentType(filename);
  if (!type) {
    return Effect.fail(attachmentInvalid(path, 'file type is not allowed'));
  }
  if (!isValidAttachmentFilename(filename)) {
    return Effect.fail(attachmentInvalid(path, 'filename is not valid'));
  }
  return Effect.succeed(type.mimeType);
}

/**
 * Validates one path: exists and is a regular file, non-empty, within the size
 * limit, allowlisted type, valid basename.
 */
function prepareOneAttachment(path: string): Effect.Effect<PreparedAttachment, HandoffError> {
  return Effect.gen(function* () {
    const filename = basename(path);

    const stats = yield* Effect.tryPromise({
      try: () => stat(path),
      catch: () => attachmentInvalid(path, 'file does not exist or cannot be read'),
    });
    yield* validateFileStats(path, stats);
    const mimeType = yield* resolveAttachmentType(path, filename);

    return { path, filename, sizeBytes: stats.size, mimeType };
  });
}

/** Validates the target role and per-handoff count before any file work. */
function validateAttachmentEnvelope(
  paths: readonly string[],
  nextRole: string
): Effect.Effect<void, HandoffError> {
  // Match the backend, which lowercases the target role before comparing.
  const normalizedNextRole = nextRole.trim().toLowerCase();
  if (normalizedNextRole !== 'user') {
    return Effect.fail({ _tag: 'AttachmentsRequireUserTarget' });
  }
  if (paths.length > FILE_ATTACHMENT_MAX_PER_HANDOFF) {
    return Effect.fail({
      _tag: 'AttachmentLimitExceeded',
      max: FILE_ATTACHMENT_MAX_PER_HANDOFF,
      count: paths.length,
    });
  }
  return Effect.void;
}

/**
 * Validates every path in declaration order: user target, count, then each
 * file. Fails on the first problem.
 */
export function prepareHandoffAttachments(
  paths: readonly string[],
  nextRole: string
): Effect.Effect<PreparedAttachment[], HandoffError> {
  return Effect.gen(function* () {
    if (paths.length === 0) return [];
    yield* validateAttachmentEnvelope(paths, nextRole);

    const prepared: PreparedAttachment[] = [];
    for (const path of paths) {
      prepared.push(yield* prepareOneAttachment(path));
    }
    return prepared;
  });
}

/** Best-effort discard; errors are swallowed because cleanup must not mask the cause. */
export function discardHandoffAttachments(
  uploader: FileAttachmentUploaderOps,
  sessionId: string,
  attachmentIds: readonly string[]
): Effect.Effect<void> {
  if (attachmentIds.length === 0) return Effect.void;
  return Effect.tryPromise({
    try: () => uploader.discardUploads({ sessionId, attachmentIds: [...attachmentIds] }),
    catch: () => undefined,
  }).pipe(Effect.catch(() => Effect.void));
}

/** Reads one file's bytes, reserves an upload, and posts the bytes. */
function uploadOneFile(
  uploader: FileAttachmentUploaderOps,
  args: {
    sessionId: string;
    chatroomId: string;
    senderRole: string;
  },
  file: PreparedAttachment
): Effect.Effect<string, HandoffError> {
  return Effect.gen(function* () {
    const bytes = yield* Effect.tryPromise({
      try: () => readFile(file.path),
      catch: (cause) => uploadFailed(file.filename, cause),
    });

    const begun = yield* Effect.tryPromise({
      try: () =>
        uploader.beginUpload({
          sessionId: args.sessionId,
          chatroomId: args.chatroomId,
          senderRole: args.senderRole,
          filename: file.filename,
          sizeBytes: file.sizeBytes,
        }),
      catch: (cause) => uploadFailed(file.filename, cause),
    });

    yield* Effect.tryPromise({
      try: () =>
        uploader.uploadBytes({
          sessionId: args.sessionId,
          attachmentId: begun.attachmentId,
          uploadUrl: begun.uploadUrl,
          bytes,
        }),
      catch: (cause) => uploadFailed(file.filename, cause),
    }).pipe(
      // The reservation exists even when the POST never completed, so release
      // it now instead of leaving a pending row until the 15-minute expiry.
      Effect.tapError(() =>
        discardHandoffAttachments(uploader, args.sessionId, [begun.attachmentId])
      )
    );

    return begun.attachmentId;
  });
}

/**
 * Uploads each file sequentially and returns the bound ids in input order.
 *
 * Reads bytes per file just before its upload. On any failure, discards the ids
 * already uploaded (best effort) and fails with the upload error.
 */
export function uploadHandoffAttachments(
  uploader: FileAttachmentUploaderOps,
  args: {
    sessionId: string;
    chatroomId: string;
    senderRole: string;
    files: readonly PreparedAttachment[];
  }
): Effect.Effect<string[], HandoffError> {
  return Effect.gen(function* () {
    const uploadedIds: string[] = [];

    const uploadAll = Effect.gen(function* () {
      for (const file of args.files) {
        uploadedIds.push(yield* uploadOneFile(uploader, args, file));
      }
    });

    yield* uploadAll.pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* discardHandoffAttachments(uploader, args.sessionId, uploadedIds);
          return yield* Effect.fail(error);
        })
      )
    );

    return uploadedIds;
  });
}
