/**
 * Handoff attachment validation and upload-loop tests.
 *
 * Uses real temp files for `prepareHandoffAttachments` and a fake
 * `FileAttachmentUploaderOps` port for the upload loop.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FILE_ATTACHMENT_MAX_BYTES,
  FILE_ATTACHMENT_MAX_PER_HANDOFF,
} from '@workspace/shared/domain/file-attachment';
import { Cause, Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { prepareHandoffAttachments, uploadHandoffAttachments } from './attachments.js';
import type { FileAttachmentUploaderOps } from './deps.js';
import { FileAttachmentUploadError } from './deps.js';
import type { HandoffError } from './index.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'chatroom-attachments-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function tempPath(name: string): string {
  return join(tempDir, name);
}

async function writeTempFile(name: string, contents: Uint8Array | string): Promise<string> {
  const path = tempPath(name);
  await writeFile(path, contents);
  return path;
}

async function failureOf(effect: Effect.Effect<unknown, HandoffError>): Promise<HandoffError> {
  const exit = await Effect.runPromiseExit(effect);
  if (exit._tag === 'Success') throw new Error('expected the effect to fail');
  const option = Cause.findErrorOption(exit.cause);
  if (option._tag !== 'Some') throw new Error('expected a typed failure');
  return option.value as HandoffError;
}

function createFakeUploader(overrides: Partial<FileAttachmentUploaderOps> = {}) {
  let sequence = 0;
  const beginUpload = vi.fn(
    async (_args: {
      sessionId: string;
      chatroomId: string;
      senderRole: string;
      filename: string;
      sizeBytes: number;
    }) => ({
      attachmentId: `attachment-${++sequence}`,
      uploadUrl: `https://test.site/upload/${sequence}`,
    })
  );
  const uploadBytes = vi.fn(
    async (_args: {
      sessionId: string;
      attachmentId: string;
      uploadUrl: string;
      bytes: Uint8Array;
    }) => {}
  );
  const discardUploads = vi.fn(async (_args: { sessionId: string; attachmentIds: string[] }) => {});
  const uploader: FileAttachmentUploaderOps = {
    beginUpload,
    uploadBytes,
    discardUploads,
    ...overrides,
  };
  return { uploader, beginUpload, uploadBytes, discardUploads };
}

describe('prepareHandoffAttachments', () => {
  test('rejects any target other than user', async () => {
    const error = await failureOf(
      prepareHandoffAttachments([await writeTempFile('a.png', 'png')], 'builder')
    );

    expect(error._tag).toBe('AttachmentsRequireUserTarget');
  });

  test('rejects more than the per-handoff limit', async () => {
    const paths = await Promise.all(
      Array.from({ length: FILE_ATTACHMENT_MAX_PER_HANDOFF + 1 }, (_, index) =>
        writeTempFile(`file-${index}.png`, 'png')
      )
    );

    const error = await failureOf(prepareHandoffAttachments(paths, 'user'));

    expect(error._tag).toBe('AttachmentLimitExceeded');
    if (error._tag === 'AttachmentLimitExceeded') {
      expect(error.max).toBe(FILE_ATTACHMENT_MAX_PER_HANDOFF);
      expect(error.count).toBe(FILE_ATTACHMENT_MAX_PER_HANDOFF + 1);
    }
  });

  test('rejects a missing file', async () => {
    const error = await failureOf(prepareHandoffAttachments([tempPath('missing.png')], 'user'));

    expect(error._tag).toBe('AttachmentInvalid');
    if (error._tag === 'AttachmentInvalid') {
      expect(error.path).toBe(tempPath('missing.png'));
    }
  });

  test('rejects a directory', async () => {
    const directory = tempPath('a-directory.png');
    await mkdir(directory);

    const error = await failureOf(prepareHandoffAttachments([directory], 'user'));

    expect(error._tag).toBe('AttachmentInvalid');
  });

  test('rejects a file over the size limit', async () => {
    const path = await writeTempFile('too-big.png', new Uint8Array(FILE_ATTACHMENT_MAX_BYTES + 1));

    const error = await failureOf(prepareHandoffAttachments([path], 'user'));

    expect(error._tag).toBe('AttachmentInvalid');
  });

  test('rejects a non-allowlisted extension', async () => {
    const path = await writeTempFile('malware.exe', 'MZ');

    const error = await failureOf(prepareHandoffAttachments([path], 'user'));

    expect(error._tag).toBe('AttachmentInvalid');
  });

  test('rejects an invalid filename', async () => {
    const path = await writeTempFile('bad\nname.png', 'png');

    const error = await failureOf(prepareHandoffAttachments([path], 'user'));

    expect(error._tag).toBe('AttachmentInvalid');
  });

  test('returns metadata for an allowlisted file', async () => {
    const path = await writeTempFile('notes.pdf', 'pdf-bytes');

    const prepared = await Effect.runPromise(prepareHandoffAttachments([path], 'user'));

    expect(prepared).toEqual([
      { path, filename: 'notes.pdf', sizeBytes: 9, mimeType: 'application/pdf' },
    ]);
  });
});

describe('uploadHandoffAttachments', () => {
  test('uploads files sequentially and returns ids in input order', async () => {
    const first = await writeTempFile('first.png', 'first');
    const second = await writeTempFile('second.pdf', 'second');
    const files = [
      { path: first, filename: 'first.png', sizeBytes: 5, mimeType: 'image/png' as const },
      { path: second, filename: 'second.pdf', sizeBytes: 6, mimeType: 'application/pdf' as const },
    ];
    const { uploader, beginUpload, uploadBytes } = createFakeUploader();

    const ids = await Effect.runPromise(
      uploadHandoffAttachments(uploader, {
        sessionId: 'session-1',
        chatroomId: 'room-1',
        senderRole: 'builder',
        files,
      })
    );

    expect(ids).toEqual(['attachment-1', 'attachment-2']);
    expect(beginUpload.mock.calls.map(([args]) => args.filename)).toEqual([
      'first.png',
      'second.pdf',
    ]);
    expect(uploadBytes).toHaveBeenCalledTimes(2);
    expect(Array.from(uploadBytes.mock.calls[0]![0].bytes)).toEqual(
      Array.from(new TextEncoder().encode('first'))
    );
  });

  test('discards already-uploaded ids when a later upload fails', async () => {
    const first = await writeTempFile('first.png', 'first');
    const second = await writeTempFile('second.pdf', 'second');
    const files = [
      { path: first, filename: 'first.png', sizeBytes: 5, mimeType: 'image/png' as const },
      { path: second, filename: 'second.pdf', sizeBytes: 6, mimeType: 'application/pdf' as const },
    ];
    const uploadBytes = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new FileAttachmentUploadError({
          code: 'FILE_ATTACHMENT_INVALID',
          message: 'rejected by backend',
          httpStatus: 400,
        })
      );
    const { uploader, discardUploads } = createFakeUploader({ uploadBytes });

    const error = await failureOf(
      uploadHandoffAttachments(uploader, {
        sessionId: 'session-1',
        chatroomId: 'room-1',
        senderRole: 'builder',
        files,
      })
    );

    expect(error._tag).toBe('AttachmentUploadFailed');
    if (error._tag === 'AttachmentUploadFailed') {
      expect(error.filename).toBe('second.pdf');
      expect(error.code).toBe('FILE_ATTACHMENT_INVALID');
    }
    expect(discardUploads).toHaveBeenCalledWith({
      sessionId: 'session-1',
      attachmentIds: ['attachment-1'],
    });
  });
});
