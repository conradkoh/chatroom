/**
 * User-facing copy for file attachment failures.
 *
 * Convex `ConvexError`s carry a `{ code, message, fields }` payload in `.data`
 * (see `services/backend/convex/fileAttachments.ts`). Network failures arrive as
 * a `TypeError` from `fetch` and share the connectivity fallback.
 */

interface FileAttachmentErrorData {
  code?: string;
  message?: string;
  fields?: string[];
}

const CONNECTIVITY_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

/** Copy for the error codes a file attachment call can return. */
const CODE_MESSAGES: Record<string, string> = {
  WEB_SESSION_REQUIRED: 'Files can only be managed from the web app.',
  ACCESS_DENIED: "You don't have access to these files.",
  AUTH_FAILED: 'Your session expired. Sign in again.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Reads the Convex error payload without assuming it is well formed. */
function getErrorData(err: unknown): FileAttachmentErrorData | null {
  if (!isRecord(err) || !isRecord(err.data)) return null;
  return err.data as FileAttachmentErrorData;
}

/** Maps a file attachment error to copy the user can act on. */
export function getFileAttachmentErrorMessage(err: unknown): string {
  const data = getErrorData(err);
  if (!data?.code) return CONNECTIVITY_MESSAGE;
  if (data.code === 'VALIDATION_ERROR') return data.message ?? CONNECTIVITY_MESSAGE;
  return CODE_MESSAGES[data.code] ?? CONNECTIVITY_MESSAGE;
}

/** True when a validation error is about the quota field specifically. */
export function isQuotaFieldError(err: unknown): boolean {
  const data = getErrorData(err);
  return data?.code === 'VALIDATION_ERROR' && (data.fields?.includes('quotaBytes') ?? false);
}
