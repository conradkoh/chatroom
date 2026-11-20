/**
 * User-facing copy for machine mutation errors.
 *
 * Plain `Error`s thrown by Convex mutations carry noisy `[CONVEX M(...)]` text, so
 * this module only ever surfaces mapped copy for known `ConvexError.data.code`
 * values, or an explicit message the backend chose to expose in the payload.
 */

const MACHINE_ERROR_COPY: Record<string, string> = {
  NOT_AUTHORIZED_MACHINE: "You don't have access to this machine.",
  MACHINE_NOT_FOUND: 'This machine no longer exists.',
  MACHINE_ONLINE: 'This machine is online. Stop the daemon and try again.',
};

/** The ConvexError payload (`error.data`) when present; duck-typed so no `instanceof` is needed. */
function getErrorData(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  if (!('data' in error)) return undefined;
  return (error as { data: unknown }).data;
}

/** `ConvexError.data.code` when `data` is an object with a string `code`; otherwise null. */
export function getConvexErrorCode(error: unknown): string | null {
  const data = getErrorData(error);
  if (typeof data !== 'object' || data === null) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * User-facing copy: mapped copy for a known code; else the ConvexError payload message
 * (`data` as non-empty string, or `data.message` string); else `fallback`.
 * A plain `Error` (no `data`) ALWAYS returns `fallback`.
 */
export function getMachineErrorCopy(error: unknown, fallback: string): string {
  const code = getConvexErrorCode(error);
  if (code && MACHINE_ERROR_COPY[code]) return MACHINE_ERROR_COPY[code];

  const data = getErrorData(error);
  if (typeof data === 'string' && data.trim().length > 0) return data;

  if (typeof data === 'object' && data !== null) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }

  return fallback;
}
