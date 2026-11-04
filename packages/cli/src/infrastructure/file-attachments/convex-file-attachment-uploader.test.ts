/**
 * Convex file attachment uploader adapter tests.
 *
 * Substitutes the backend ops and `fetchFn` (both ports) so the test observes
 * the exact upload request the adapter sends and how it maps error responses.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createConvexFileAttachmentUploader } from './convex-file-attachment-uploader.js';
import { FileAttachmentUploadError } from '../../commands/handoff/deps.js';
import type { BackendOps } from '../deps/index.js';

const ATTACHMENT_ID = 'attachment-1';
const BACKEND_URL = 'https://test.site';
const UPLOAD_URL = `${BACKEND_URL}/chatroom/file-attachments/upload`;

beforeEach(() => {
  vi.stubEnv('CHATROOM_CONVEX_URL', BACKEND_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function createUploader(backend: BackendOps, fetchFn: unknown = vi.fn()) {
  return createConvexFileAttachmentUploader(backend, fetchFn as typeof fetch);
}

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
    const uploader = createUploader(backend);

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
    const uploader = createUploader(backend, fetchFn);
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

  test('refuses to send the session to a different origin', async () => {
    const { backend } = createBackend();
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    const uploader = createUploader(backend, fetchFn);

    await expect(
      uploader.uploadBytes({
        sessionId: 'session-1',
        attachmentId: ATTACHMENT_ID,
        uploadUrl: 'https://evil.site/chatroom/file-attachments/upload',
        bytes: new Uint8Array([1]),
      })
    ).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_UPLOAD_URL_REJECTED' });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('refuses plaintext uploads outside loopback even on the configured origin', async () => {
    const { backend } = createBackend();
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubEnv('CHATROOM_CONVEX_URL', 'http://test.site');
    const uploader = createUploader(backend, fetchFn);

    await expect(
      uploader.uploadBytes({
        sessionId: 'session-1',
        attachmentId: ATTACHMENT_ID,
        uploadUrl: 'http://test.site/chatroom/file-attachments/upload',
        bytes: new Uint8Array([1]),
      })
    ).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_UPLOAD_URL_REJECTED' });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('refuses an upload URL that cannot be parsed', async () => {
    const { backend } = createBackend();
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    const uploader = createUploader(backend, fetchFn);

    await expect(
      uploader.uploadBytes({
        sessionId: 'session-1',
        attachmentId: ATTACHMENT_ID,
        uploadUrl: 'not a url',
        bytes: new Uint8Array([1]),
      })
    ).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_UPLOAD_URL_REJECTED' });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  test.each(['http://localhost:3210', 'http://127.0.0.1:3210', 'http://[::1]:3210'])(
    'allows loopback HTTP uploads on the configured origin %s',
    async (backendUrl) => {
      const { backend } = createBackend();
      const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
      vi.stubEnv('CHATROOM_CONVEX_URL', backendUrl);
      const uploader = createUploader(backend, fetchFn);

      await uploader.uploadBytes({
        sessionId: 'session-1',
        attachmentId: ATTACHMENT_ID,
        uploadUrl: `${backendUrl}/chatroom/file-attachments/upload`,
        bytes: new Uint8Array([1]),
      });

      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  );

  test('allows the Convex local site port next to the loopback backend port', async () => {
    const { backend } = createBackend();
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubEnv('CHATROOM_CONVEX_URL', 'http://127.0.0.1:3210');
    const uploader = createUploader(backend, fetchFn);

    await uploader.uploadBytes({
      sessionId: 'session-1',
      attachmentId: ATTACHMENT_ID,
      uploadUrl: 'http://127.0.0.1:3211/chatroom/file-attachments/upload',
      bytes: new Uint8Array([1]),
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('refuses a loopback port that is not the Convex site port', async () => {
    const { backend } = createBackend();
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubEnv('CHATROOM_CONVEX_URL', 'http://127.0.0.1:3210');
    const uploader = createUploader(backend, fetchFn);

    await expect(
      uploader.uploadBytes({
        sessionId: 'session-1',
        attachmentId: ATTACHMENT_ID,
        uploadUrl: 'http://127.0.0.1:9999/chatroom/file-attachments/upload',
        bytes: new Uint8Array([1]),
      })
    ).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_UPLOAD_URL_REJECTED' });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('refuses a different port on a non-loopback HTTPS origin', async () => {
    const { backend } = createBackend();
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    const uploader = createUploader(backend, fetchFn);

    await expect(
      uploader.uploadBytes({
        sessionId: 'session-1',
        attachmentId: ATTACHMENT_ID,
        uploadUrl: 'https://test.site:8443/chatroom/file-attachments/upload',
        bytes: new Uint8Array([1]),
      })
    ).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_UPLOAD_URL_REJECTED' });

    expect(fetchFn).not.toHaveBeenCalled();
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
    const uploader = createUploader(backend, fetchFn);

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
    const uploader = createUploader(backend, fetchFn);

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
    const uploader = createUploader(backend);

    await uploader.discardUploads({ sessionId: 'session-1', attachmentIds: ['a', 'b'] });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'session-1',
      attachmentIds: ['a', 'b'],
    });
  });
});
