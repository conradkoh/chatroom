/**
 * Convex file attachment uploader adapter tests.
 *
 * Substitutes the backend ops and `fetchFn` (both ports) so the test observes
 * the exact upload request the adapter sends and how it maps error responses.
 */

import { describe, expect, test, vi } from 'vitest';

import { createConvexFileAttachmentUploader } from './convex-file-attachment-uploader.js';
import { FileAttachmentUploadError } from '../../commands/handoff/deps.js';
import type { BackendOps } from '../deps/index.js';

const ATTACHMENT_ID = 'attachment-1';
const UPLOAD_URL = 'https://test.site/chatroom/file-attachments/upload';

function createBackend(result: unknown = { attachmentId: ATTACHMENT_ID, uploadUrl: UPLOAD_URL }) {
  const mutation = vi.fn(async () => result);
  const backend: BackendOps = {
    mutation,
    query: vi.fn(),
  };
  return { backend, mutation };
}

describe('createConvexFileAttachmentUploader', () => {
  test('begins an upload through the backend and returns its ticket', async () => {
    const { backend, mutation } = createBackend({
      attachmentId: ATTACHMENT_ID,
      uploadUrl: UPLOAD_URL,
      expiresAt: 123,
    });
    const uploader = createConvexFileAttachmentUploader(
      backend,
      vi.fn() as unknown as typeof fetch
    );

    await expect(
      uploader.beginUpload({
        sessionId: 'session-1',
        chatroomId: 'room-1',
        senderRole: 'planner',
        filename: 'notes.txt',
        sizeBytes: 5,
      })
    ).resolves.toEqual({ attachmentId: ATTACHMENT_ID, uploadUrl: UPLOAD_URL });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'session-1',
      chatroomId: 'room-1',
      senderRole: 'planner',
      filename: 'notes.txt',
      sizeBytes: 5,
    });
  });

  test('posts the exact bytes with the upload headers', async () => {
    const { backend } = createBackend();
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    const uploader = createConvexFileAttachmentUploader(
      backend,
      fetchFn as unknown as typeof fetch
    );
    const bytes = new Uint8Array([1, 2, 3, 4]);

    await uploader.uploadBytes({
      sessionId: 'session-1',
      attachmentId: ATTACHMENT_ID,
      uploadUrl: UPLOAD_URL,
      bytes,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(UPLOAD_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer session-1',
      'X-Chatroom-Attachment-Id': ATTACHMENT_ID,
      'Content-Type': 'application/octet-stream',
      'Content-Length': '4',
    });
    expect(Array.from(init.body as Uint8Array)).toEqual([1, 2, 3, 4]);
  });

  test('maps a JSON error response to FileAttachmentUploadError with its status', async () => {
    const { backend } = createBackend();
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: false, code: 'FILE_ATTACHMENT_TOO_LARGE', message: 'too big' }),
          { status: 413, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const uploader = createConvexFileAttachmentUploader(
      backend,
      fetchFn as unknown as typeof fetch
    );

    const error = await uploader
      .uploadBytes({
        sessionId: 'session-1',
        attachmentId: ATTACHMENT_ID,
        uploadUrl: UPLOAD_URL,
        bytes: new Uint8Array([1]),
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(FileAttachmentUploadError);
    expect(error).toMatchObject({
      code: 'FILE_ATTACHMENT_TOO_LARGE',
      message: 'too big',
      httpStatus: 413,
    });
  });

  test('falls back to a generic code when the error body is not JSON', async () => {
    const { backend } = createBackend();
    const fetchFn = vi.fn(async () => new Response('gateway exploded', { status: 502 }));
    const uploader = createConvexFileAttachmentUploader(
      backend,
      fetchFn as unknown as typeof fetch
    );

    const error = await uploader
      .uploadBytes({
        sessionId: 'session-1',
        attachmentId: ATTACHMENT_ID,
        uploadUrl: UPLOAD_URL,
        bytes: new Uint8Array([1]),
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(FileAttachmentUploadError);
    expect(error).toMatchObject({
      code: 'FILE_ATTACHMENT_UPLOAD_FAILED',
      httpStatus: 502,
    });
  });

  test('discards uploads through the backend mutation', async () => {
    const { backend, mutation } = createBackend({ discarded: 1 });
    const uploader = createConvexFileAttachmentUploader(
      backend,
      vi.fn() as unknown as typeof fetch
    );

    await uploader.discardUploads({ sessionId: 'session-1', attachmentIds: ['a', 'b'] });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'session-1',
      attachmentIds: ['a', 'b'],
    });
  });
});
