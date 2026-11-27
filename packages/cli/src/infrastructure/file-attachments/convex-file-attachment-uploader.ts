/**
 * Convex-backed file attachment uploader.
 *
 * The only place in the CLI that touches `fetch` and the attachment backend
 * mutations. Bytes go straight to the upload URL returned by `beginUpload`;
 * the adapter never reads a blob back. Because the upload POST carries the
 * session bearer token, the URL is checked against the configured backend
 * origin before any request is sent.
 */

import { assertUploadUrlAllowed } from './upload-url-guard.js';
import { api } from '../../api.js';
import type { FileAttachmentUploaderOps } from '../../commands/handoff/deps.js';
import { FileAttachmentUploadError } from '../../commands/handoff/deps.js';
import { getConvexUrl } from '../convex/client.js';
import type { BackendOps } from '../deps/index.js';

const ATTACHMENT_ID_HEADER = 'X-Chatroom-Attachment-Id';
const DEFAULT_UPLOAD_ERROR_CODE = 'FILE_ATTACHMENT_UPLOAD_FAILED';
const REJECTED_UPLOAD_URL_CODE = 'FILE_ATTACHMENT_UPLOAD_URL_REJECTED';

export function createConvexFileAttachmentUploader(
  backend: BackendOps,
  fetchFn: typeof fetch = fetch
): FileAttachmentUploaderOps {
  const backendUrl = getConvexUrl();
  return {
    beginUpload: async (args) => {
      const result = await backend.mutation(api.fileAttachments.beginUpload, args);
      return {
        attachmentId: result.attachmentId as string,
        uploadUrl: result.uploadUrl as string,
      };
    },

    uploadBytes: async ({ sessionId, attachmentId, uploadUrl, bytes }) => {
      assertUploadUrlAllowed(uploadUrl, backendUrl, rejectedUploadUrl);

      const response = await fetchFn(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionId}`,
          [ATTACHMENT_ID_HEADER]: attachmentId,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(bytes.byteLength),
        },
        body: bytes as unknown as BodyInit,
      });

      if (response.ok) return;

      const { code, message } = await readUploadError(response);
      throw new FileAttachmentUploadError({ code, message, httpStatus: response.status });
    },

    discardUploads: async ({ sessionId, attachmentIds }) => {
      await backend.mutation(api.fileAttachments.discardUploads, { sessionId, attachmentIds });
    },
  };
}

function rejectedUploadUrl(message: string): FileAttachmentUploadError {
  return new FileAttachmentUploadError({
    code: REJECTED_UPLOAD_URL_CODE,
    message,
    // No HTTP request was made, so there is no response status.
    httpStatus: 0,
  });
}

/** Parses `{ code, message }` from a failed upload response, with a generic fallback. */
async function readUploadError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    return {
      code: typeof body.code === 'string' ? body.code : DEFAULT_UPLOAD_ERROR_CODE,
      message:
        typeof body.message === 'string'
          ? body.message
          : `Upload failed with status ${response.status}`,
    };
  } catch {
    return {
      code: DEFAULT_UPLOAD_ERROR_CODE,
      message: `Upload failed with status ${response.status}`,
    };
  }
}
