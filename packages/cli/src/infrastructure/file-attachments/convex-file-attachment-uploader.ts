/**
 * Convex-backed file attachment uploader.
 *
 * The only place in the CLI that touches `fetch` and the attachment backend
 * mutations. Bytes go straight to the upload URL returned by `beginUpload`;
 * the adapter never reads a blob back. Because the upload POST carries the
 * session bearer token, the URL is checked against the configured backend
 * origin before any request is sent.
 */

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
      assertUploadUrlAllowed(uploadUrl, backendUrl);

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

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** True when `uploadPort` is the Convex site port next to `backendPort`. */
function isConvexLocalSitePort(uploadPort: string, backendPort: string): boolean {
  return uploadPort !== '' && backendPort !== '' && Number(uploadPort) === Number(backendPort) + 1;
}

function parseUploadUrl(uploadUrl: string, backendUrl: string): { upload: URL; backend: URL } {
  try {
    return { upload: new URL(uploadUrl), backend: new URL(backendUrl) };
  } catch {
    throw rejectedUploadUrl('Upload URL is not a valid URL');
  }
}

function isSupportedUploadProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

function requiresHttps(upload: URL): boolean {
  return upload.protocol === 'http:' && !isLoopbackHostname(upload.hostname);
}

/** HTTPS is required unless the upload targets loopback (local Convex). */
function assertUploadProtocol(upload: URL): void {
  if (!isSupportedUploadProtocol(upload.protocol)) {
    throw rejectedUploadUrl(`Upload URL uses an unsupported protocol: ${upload.protocol}`);
  }
  if (requiresHttps(upload)) {
    throw rejectedUploadUrl('Upload URL must use HTTPS unless it targets loopback');
  }
}

/**
 * Convex local dev serves HTTP actions on the port after the cloud port. Any
 * two loopback hosts qualify (for example localhost and 127.0.0.1), because
 * the port pairing identifies the same local deployment.
 */
function isConvexLocalSiteUrl(upload: URL, backend: URL): boolean {
  return (
    isLoopbackHostname(upload.hostname) &&
    isLoopbackHostname(backend.hostname) &&
    isConvexLocalSitePort(upload.port, backend.port)
  );
}

const CONVEX_CLOUD_SUFFIX = '.convex.cloud';
const CONVEX_SITE_SUFFIX = '.convex.site';

/** Production Convex serves HTTP actions on `<name>.convex.site`, paired with `<name>.convex.cloud`. */
function isConvexCloudSiteUrl(upload: URL, backend: URL): boolean {
  if (backend.protocol !== 'https:' || backend.port !== '') return false;
  if (!backend.hostname.endsWith(CONVEX_CLOUD_SUFFIX)) return false;

  const siteOrigin = `https://${backend.hostname.slice(
    0,
    -CONVEX_CLOUD_SUFFIX.length
  )}${CONVEX_SITE_SUFFIX}`;
  return upload.origin === siteOrigin;
}

/**
 * The upload POST carries the session bearer token, so only send it to the
 * configured backend origin. Two Convex conventions are also accepted: the
 * production site origin paired with a `<name>.convex.cloud` backend
 * (`<name>.convex.site`), and the local site port (cloud port + 1) next to a
 * loopback backend, where local HTTP actions are served.
 */
function assertUploadUrlAllowed(uploadUrl: string, backendUrl: string): void {
  const { upload, backend } = parseUploadUrl(uploadUrl, backendUrl);

  assertUploadProtocol(upload);
  if (
    upload.origin === backend.origin ||
    isConvexLocalSiteUrl(upload, backend) ||
    isConvexCloudSiteUrl(upload, backend)
  ) {
    return;
  }

  throw rejectedUploadUrl(
    `Upload URL origin ${upload.origin} does not match the configured backend ${backend.origin}`
  );
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
