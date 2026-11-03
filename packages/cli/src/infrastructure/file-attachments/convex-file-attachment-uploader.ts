/**
 * Convex-backed file attachment uploader.
 *
 * The only place in the CLI that touches `fetch` and the attachment backend
 * mutations. Bytes go straight to the upload URL returned by `beginUpload`;
 * the adapter never reads a blob back.
 */

import { api } from '../../api.js';
import type { FileAttachmentUploaderOps } from '../../commands/handoff/deps.js';
import { FileAttachmentUploadError } from '../../commands/handoff/deps.js';
import type { BackendOps } from '../deps/index.js';

const ATTACHMENT_ID_HEADER = 'X-Chatroom-Attachment-Id';
const DEFAULT_UPLOAD_ERROR_CODE = 'FILE_ATTACHMENT_UPLOAD_FAILED';

export function createConvexFileAttachmentUploader(
  backend: BackendOps,
  fetchFn: typeof fetch = fetch
): FileAttachmentUploaderOps {
  return {
    beginUpload: async (args) => {
      const result = await backend.mutation(api.fileAttachments.beginUpload, args);
      return {
        attachmentId: result.attachmentId as string,
        uploadUrl: result.uploadUrl as string,
      };
    },

    uploadBytes: async ({ sessionId, attachmentId, uploadUrl, bytes }) => {
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
