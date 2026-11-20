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

/** A non-empty string payload, or null. */
function stringPayloadMessage(data: unknown): string | null {
  if (typeof data !== 'string') return null;
  return data.trim().length > 0 ? data : null;
}

/** Non-null object guard. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** An object payload's non-empty `message`, or null. */
function objectPayloadMessage(data: unknown): string | null {
  if (!isObject(data)) return null;
  const message = data.message;
  return typeof message === 'string' && message.trim().length > 0 ? message : null;
}

/** Copy mapped to a known backend error code, when there is one. */
function mappedCopy(code: string | null): string | undefined {
  if (!code) return undefined;
  return MACHINE_ERROR_COPY[code];
}

/** `ConvexError.data.code` when `data` is an object with a string `code`; otherwise null. */
// fallow-ignore-next-line unused-export
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
  const mapped = mappedCopy(getConvexErrorCode(error));
  if (mapped) return mapped;

  const data = getErrorData(error);
  return stringPayloadMessage(data) ?? objectPayloadMessage(data) ?? fallback;
}
