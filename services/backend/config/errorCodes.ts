/**
 * Shared error codes for backend errors that the CLI needs to handle.
 *
 * Used with ConvexError to provide structured, machine-readable error responses.
 * Both the backend (Convex functions) and CLI can import this module to share
 * error code definitions and determine appropriate error handling behavior.
 *
 * To add a new error code:
 * 1. Add the string literal to the `BackendErrorCode` union type
 * 2. Add the corresponding entry to `BACKEND_ERROR_CODES`
 * 3. If the error should cause the CLI to exit, add it to `FATAL_ERROR_CODES`
 */

/**
 * All known backend error codes as a string literal union.
 * Each code uniquely identifies an error condition.
 */
export type BackendErrorCode = 'PARTICIPANT_NOT_FOUND' | 'CHATROOM_NOT_FOUND' | 'SESSION_INVALID';

/**
 * Mapping of error names to their string code values.
 * Use this for programmatic access to error codes (avoids typos in string literals).
 */
export const BACKEND_ERROR_CODES = {
  /** Participant record doesn't exist in the chatroom */
  PARTICIPANT_NOT_FOUND: 'PARTICIPANT_NOT_FOUND',
  /** Chatroom doesn't exist */
  CHATROOM_NOT_FOUND: 'CHATROOM_NOT_FOUND',
  /** Session is invalid or expired */
  SESSION_INVALID: 'SESSION_INVALID',
} as const satisfies Record<BackendErrorCode, BackendErrorCode>;

/**
 * Shape of a structured backend error for use with ConvexError.
 *
 * Usage in backend:
 * ```ts
 * throw new ConvexError<BackendError>({
 *   code: BACKEND_ERROR_CODES.PARTICIPANT_NOT_FOUND,
 *   message: 'Participant not found in chatroom',
 * });
 * ```
 *
 * Usage in CLI:
 * ```ts
 * if (error instanceof ConvexError) {
 *   const data = error.data as BackendError;
 *   if (FATAL_ERROR_CODES.includes(data.code)) process.exit(1);
 * }
 * ```
 */
export type BackendError = {
  code: BackendErrorCode;
  message: string;
};

/**
 * Error codes that should cause the CLI process to exit immediately.
 * These represent unrecoverable states where continuing would be pointless.
 */
export const FATAL_ERROR_CODES: readonly BackendErrorCode[] = [
  BACKEND_ERROR_CODES.PARTICIPANT_NOT_FOUND,
  BACKEND_ERROR_CODES.CHATROOM_NOT_FOUND,
  BACKEND_ERROR_CODES.SESSION_INVALID,
] as const;
