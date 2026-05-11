/**
 * Shared error codes for backend errors that the CLI needs to handle.
 *
 * Used with ConvexError to provide structured, machine-readable error responses.
 * Both the backend (Convex functions) and CLI can import this module to share
 * error code definitions and determine appropriate error handling behavior.
 *
 * CONVENTION:
 * - Throw `ConvexError({ code, message, fields? })` for exceptional conditions.
 * - Return a discriminated union (e.g. `GetNextTaskResponse`) when the failure
 *   is a normal expected business outcome the caller MUST branch on.
 * - Decision rule: "Will most callers branch on this outcome rather than treat
 *   it as an error? → union. Otherwise → throw."
 * - Bare-string throws (`throw new ConvexError('...')`) are forbidden by the
 *   enforcement test. New code must always use the structured form.
 * - Every code used in a `throw new ConvexError({ code: ... })` must be
 *   registered here. The enforcement test verifies this at CI time.
 *
 * To add a new error code:
 * 1. Add the string literal to the `BackendErrorCode` union type
 * 2. Add the corresponding entry to `BACKEND_ERROR_CODES`
 * 3. Add it to either `FATAL_ERROR_CODES` or `NON_FATAL_ERROR_CODES`
 *    (the test suite verifies every code is classified)
 * 4. The enforcement test will automatically verify it's registered.
 */

/**
 * All known backend error codes as a string literal union.
 * Each code uniquely identifies an error condition.
 */
export type BackendErrorCode =
  // ── Authentication & Authorization ─────────────────────────────────────
  | 'SESSION_INVALID'
  | 'FEATURE_DISABLED'
  | 'NOT_AUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'ACCESS_DENIED'
  | 'AUTH_FAILED'
  | 'EMAIL_ALREADY_EXISTS'
  | 'NO_GOOGLE_ACCOUNT'
  | 'GOOGLE_ACCOUNT_IN_USE'
  | 'INVALID_USER_TYPE'
  | 'USER_TYPE_MISMATCH'
  | 'USER_NOT_FOUND'
  | 'OAUTH_ERROR'
  | 'LOGIN_ERROR'

  // ── Chatroom ──────────────────────────────────────────────────────────
  | 'CHATROOM_NOT_FOUND'
  | 'TEAM_REQUIRED'
  | 'CONFIGURATION_ERROR'

  // ── Participants ───────────────────────────────────────────────────────
  | 'PARTICIPANT_NOT_FOUND'

  // ── Context ────────────────────────────────────────────────────────────
  | 'CONTEXT_NO_HANDOFF_SINCE_LAST_CONTEXT'
  | 'CONTEXT_NOT_FOUND'
  | 'CONTEXT_RESTRICTED'

  // ── Messages ───────────────────────────────────────────────────────────
  | 'INVALID_ROLE'
  | 'INVALID_CONTENT'
  | 'MISSING_CLASSIFICATION'
  | 'MESSAGE_NOT_CLASSIFIED'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN_PARAM'
  | 'INVALID_CONVERSION'
  | 'INVALID_STATE'
  | 'INVALID_STDIN_FORMAT'
  | 'MISSING_STDIN'
  | 'MISSING_SPECIFICATION'

  // ── Tasks ─────────────────────────────────────────────────────────────
  | 'TASK_NOT_FOUND'
  | 'INVALID_TASK'
  | 'QUEUED_MESSAGE_NOT_FOUND'
  | 'INVALID_TASK_STATUS'
  | 'TASK_INVALID_TRANSITION'
  | 'TASK_MISSING_REQUIRED_FIELD'
  | 'TASK_VALIDATION_FAILED'

  // ── Backlog ────────────────────────────────────────────────────────────
  | 'BACKLOG_ITEM_NOT_FOUND'
  | 'BACKLOG_ITEM_WRONG_CHATROOM'
  | 'BACKLOG_INVALID_TRANSITION'
  | 'BACKLOG_MISSING_REQUIRED_FIELD'
  | 'BACKLOG_VALIDATION_FAILED'
  | 'CONTENT_EMPTY'
  | 'REASON_EMPTY'

  // ── Commands ──────────────────────────────────────────────────────────
  | 'NOT_AUTHORIZED_MACHINE'
  | 'COMMAND_NOT_FOUND'
  | 'COMMAND_NOT_DISCOVERED'
  | 'RUN_NOT_FOUND'
  | 'RUN_WRONG_MACHINE'
  | 'COMMAND_NOT_RUNNING'
  | 'TOO_MANY_COMMANDS'
  | 'INVALID_STATE_TRANSITION'
  | 'OUTPUT_CHUNK_TOO_LARGE'

  // ── Integrations ──────────────────────────────────────────────────────
  | 'NOT_FOUND'
  | 'INVALID_BOT_TOKEN'
  | 'WEBHOOK_REGISTRATION_FAILED'
  | 'WEBHOOK_REMOVAL_FAILED'

  // ── Workflows ─────────────────────────────────────────────────────────
  | 'WORKFLOW_REQUIRED'

  // ── Agent / Machine ──────────────────────────────────────────────────
  | 'ALREADY_CONNECTED'
  | 'CONNECT_ERROR'
  | 'UNSAFE_DISCONNECT'
  | 'HANDOFF_RESTRICTED'
  | 'CHATROOM_NO_TEAM_ID'

  // ── Direct Harness Sessions ──────────────────────────────────────────
  | 'HARNESS_SESSION_INVALID_AGENT'
  | 'HARNESS_SESSION_INVALID_PROMPT'
  | 'HARNESS_SESSION_CLOSED'
  | 'HARNESS_SESSION_UNKNOWN_AGENT'

  // ── Skills ──────────────────────────────────────────────────────────
  | 'SKILL_NOT_FOUND_OR_DISABLED'
  | 'MISSING_FEATURE_METADATA'

  // ── Saved Commands ──────────────────────────────────────────────────
  | 'COMMAND_NAME_EMPTY'
  | 'SAVED_COMMAND_NOT_FOUND'
  | 'COMMAND_TYPE_IMMUTABLE'

  // ── Attendance ──────────────────────────────────────────────────────
  | 'NAME_REQUIRED'
  | 'ATTENDANCE_NOT_FOUND'
  | 'ATTENDANCE_DELETE_UNAUTHORIZED'

  // ── Items ──────────────────────────────────────────────────────────
  | 'ITEM_NOT_FOUND'
  | 'INVALID_ITEM'
  | 'INVALID_ITEM_STATUS'
  | 'INVALID_MESSAGE'
  | 'MESSAGE_NOT_FOUND'

  // ── Conflict ──────────────────────────────────────────────────────
  | 'CONFLICT';

/**
 * Mapping of error names to their string code values.
 * Use this for programmatic access to error codes (avoids typos in string literals).
 */
export const BACKEND_ERROR_CODES = {
  // ── Authentication & Authorization ─────────────────────────────────────
  /** Session is invalid or expired */
  SESSION_INVALID: 'SESSION_INVALID',
  /** Feature is disabled by admin config */
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  /** User is not authenticated */
  NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
  /** User lacks required permissions */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** User is authenticated but action is forbidden */
  FORBIDDEN: 'FORBIDDEN',
  /** Access denied to a resource */
  ACCESS_DENIED: 'ACCESS_DENIED',
  /** Authentication attempt failed */
  AUTH_FAILED: 'AUTH_FAILED',
  /** Email is already registered */
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  /** User has no linked Google account */
  NO_GOOGLE_ACCOUNT: 'NO_GOOGLE_ACCOUNT',
  /** A different Google account is already linked */
  GOOGLE_ACCOUNT_IN_USE: 'GOOGLE_ACCOUNT_IN_USE',
  /** User type does not match expected type */
  INVALID_USER_TYPE: 'INVALID_USER_TYPE',
  /** User type mismatch between expected and actual */
  USER_TYPE_MISMATCH: 'USER_TYPE_MISMATCH',
  /** User record not found */
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  /** OAuth flow error */
  OAUTH_ERROR: 'OAUTH_ERROR',
  /** Login error */
  LOGIN_ERROR: 'LOGIN_ERROR',

  // ── Chatroom ──────────────────────────────────────────────────────────
  /** Chatroom not found */
  CHATROOM_NOT_FOUND: 'CHATROOM_NOT_FOUND',
  /** Team must have at least one role */
  TEAM_REQUIRED: 'TEAM_REQUIRED',
  /** Chatroom configuration error (e.g. missing teamId) */
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',

  // ── Participants ───────────────────────────────────────────────────────
  /** Participant not found in chatroom */
  PARTICIPANT_NOT_FOUND: 'PARTICIPANT_NOT_FOUND',

  // ── Context ────────────────────────────────────────────────────────────
  /** Cannot create context without a handoff since last context */
  CONTEXT_NO_HANDOFF_SINCE_LAST_CONTEXT: 'CONTEXT_NO_HANDOFF_SINCE_LAST_CONTEXT',
  /** Context document not found */
  CONTEXT_NOT_FOUND: 'CONTEXT_NOT_FOUND',
  /** Context access restricted */
  CONTEXT_RESTRICTED: 'CONTEXT_RESTRICTED',

  // ── Messages ───────────────────────────────────────────────────────────
  /** Invalid sender role */
  INVALID_ROLE: 'INVALID_ROLE',
  /** Message content is invalid or empty */
  INVALID_CONTENT: 'INVALID_CONTENT',
  /** Classification is missing when required */
  MISSING_CLASSIFICATION: 'MISSING_CLASSIFICATION',
  /** Message has no classification */
  MESSAGE_NOT_CLASSIFIED: 'MESSAGE_NOT_CLASSIFIED',
  /** Generic validation error */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  /** Unknown parameter in request */
  UNKNOWN_PARAM: 'UNKNOWN_PARAM',
  /** Invalid conversion attempt */
  INVALID_CONVERSION: 'INVALID_CONVERSION',
  /** Invalid state for the operation */
  INVALID_STATE: 'INVALID_STATE',
  /** Invalid stdin format */
  INVALID_STDIN_FORMAT: 'INVALID_STDIN_FORMAT',
  /** Missing required stdin input */
  MISSING_STDIN: 'MISSING_STDIN',
  /** Missing required specification */
  MISSING_SPECIFICATION: 'MISSING_SPECIFICATION',

  // ── Tasks ─────────────────────────────────────────────────────────────
  /** Task not found */
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  /** Task reference is invalid (e.g. belongs to different chatroom) */
  INVALID_TASK: 'INVALID_TASK',
  /** Queued message referenced by task not found */
  QUEUED_MESSAGE_NOT_FOUND: 'QUEUED_MESSAGE_NOT_FOUND',
  /** Task status is invalid for the operation */
  INVALID_TASK_STATUS: 'INVALID_TASK_STATUS',
  /** Invalid task state transition */
  TASK_INVALID_TRANSITION: 'TASK_INVALID_TRANSITION',
  /** Task missing required field */
  TASK_MISSING_REQUIRED_FIELD: 'TASK_MISSING_REQUIRED_FIELD',
  /** Task validation failed */
  TASK_VALIDATION_FAILED: 'TASK_VALIDATION_FAILED',

  // ── Backlog ────────────────────────────────────────────────────────────
  /** Backlog item not found */
  BACKLOG_ITEM_NOT_FOUND: 'BACKLOG_ITEM_NOT_FOUND',
  /** Backlog item does not belong to the specified chatroom */
  BACKLOG_ITEM_WRONG_CHATROOM: 'BACKLOG_ITEM_WRONG_CHATROOM',
  /** Invalid backlog item status transition */
  BACKLOG_INVALID_TRANSITION: 'BACKLOG_INVALID_TRANSITION',
  /** Backlog item missing required field */
  BACKLOG_MISSING_REQUIRED_FIELD: 'BACKLOG_MISSING_REQUIRED_FIELD',
  /** Backlog item validation failed */
  BACKLOG_VALIDATION_FAILED: 'BACKLOG_VALIDATION_FAILED',
  /** Content is empty or whitespace-only */
  CONTENT_EMPTY: 'CONTENT_EMPTY',
  /** Reason is required but empty */
  REASON_EMPTY: 'REASON_EMPTY',

  // ── Commands ──────────────────────────────────────────────────────────
  /** Not authorized for the target machine */
  NOT_AUTHORIZED_MACHINE: 'NOT_AUTHORIZED_MACHINE',
  /** Command not found */
  COMMAND_NOT_FOUND: 'COMMAND_NOT_FOUND',
  /** Only discovered scripts can be run */
  COMMAND_NOT_DISCOVERED: 'COMMAND_NOT_DISCOVERED',
  /** Command run not found */
  RUN_NOT_FOUND: 'RUN_NOT_FOUND',
  /** Run does not belong to the specified machine */
  RUN_WRONG_MACHINE: 'RUN_WRONG_MACHINE',
  /** Command is not currently running */
  COMMAND_NOT_RUNNING: 'COMMAND_NOT_RUNNING',
  /** Too many commands synced at once */
  TOO_MANY_COMMANDS: 'TOO_MANY_COMMANDS',
  /** Invalid command status transition */
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  /** Output chunk exceeds size limit */
  OUTPUT_CHUNK_TOO_LARGE: 'OUTPUT_CHUNK_TOO_LARGE',

  // ── Integrations ──────────────────────────────────────────────────────
  /** Generic not found */
  NOT_FOUND: 'NOT_FOUND',
  /** Invalid bot token */
  INVALID_BOT_TOKEN: 'INVALID_BOT_TOKEN',
  /** Webhook registration failed */
  WEBHOOK_REGISTRATION_FAILED: 'WEBHOOK_REGISTRATION_FAILED',
  /** Webhook removal failed */
  WEBHOOK_REMOVAL_FAILED: 'WEBHOOK_REMOVAL_FAILED',

  // ── Workflows ─────────────────────────────────────────────────────────
  /** Workflow is required for this operation */
  WORKFLOW_REQUIRED: 'WORKFLOW_REQUIRED',

  // ── Agent / Machine ──────────────────────────────────────────────────
  /** Already connected to the chatroom */
  ALREADY_CONNECTED: 'ALREADY_CONNECTED',
  /** Connection error */
  CONNECT_ERROR: 'CONNECT_ERROR',
  /** Unsafe disconnect */
  UNSAFE_DISCONNECT: 'UNSAFE_DISCONNECT',
  /** Handoff restricted */
  HANDOFF_RESTRICTED: 'HANDOFF_RESTRICTED',
  /** Chatroom has no teamId — cannot build agent config key */
  CHATROOM_NO_TEAM_ID: 'CHATROOM_NO_TEAM_ID',

  // ── Direct Harness Sessions ──────────────────────────────────────────
  /** Agent name is required but was empty or missing */
  HARNESS_SESSION_INVALID_AGENT: 'HARNESS_SESSION_INVALID_AGENT',
  /** Prompt parts are required but were empty */
  HARNESS_SESSION_INVALID_PROMPT: 'HARNESS_SESSION_INVALID_PROMPT',
  /** Cannot submit prompt to a closed or failed session */
  HARNESS_SESSION_CLOSED: 'HARNESS_SESSION_CLOSED',
  /** Agent name not found in the machine registry */
  HARNESS_SESSION_UNKNOWN_AGENT: 'HARNESS_SESSION_UNKNOWN_AGENT',

  // ── Skills ────────────────────────────────────────────────────────────
  /** Skill not found or disabled */
  SKILL_NOT_FOUND_OR_DISABLED: 'SKILL_NOT_FOUND_OR_DISABLED',
  /** Missing feature metadata */
  MISSING_FEATURE_METADATA: 'MISSING_FEATURE_METADATA',

  // ── Saved Commands ──────────────────────────────────────────────────
  /** Command name must not be empty */
  COMMAND_NAME_EMPTY: 'COMMAND_NAME_EMPTY',
  /** Saved command not found */
  SAVED_COMMAND_NOT_FOUND: 'SAVED_COMMAND_NOT_FOUND',
  /** Cannot change command type */
  COMMAND_TYPE_IMMUTABLE: 'COMMAND_TYPE_IMMUTABLE',

  // ── Attendance ──────────────────────────────────────────────────────
  /** Name is required for anonymous attendance */
  NAME_REQUIRED: 'NAME_REQUIRED',
  /** Attendance record not found */
  ATTENDANCE_NOT_FOUND: 'ATTENDANCE_NOT_FOUND',
  /** Not authorized to delete attendance record */
  ATTENDANCE_DELETE_UNAUTHORIZED: 'ATTENDANCE_DELETE_UNAUTHORIZED',

  // ── Items / Messages ────────────────────────────────────────────────
  /** Item not found */
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  /** Invalid item reference */
  INVALID_ITEM: 'INVALID_ITEM',
  /** Invalid item status for the operation */
  INVALID_ITEM_STATUS: 'INVALID_ITEM_STATUS',
  /** Invalid message reference */
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  /** Message not found */
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',

  // ── Conflict ────────────────────────────────────────────────────────
  /** Conflict (e.g. duplicate) */
  CONFLICT: 'CONFLICT',
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
  /** Optional list of field names involved in the error (e.g. BAD_REQUEST fields) */
  fields?: string[];
};

/**
 * Error codes that should cause the CLI process to exit immediately.
 * These represent unrecoverable states where continuing would be pointless.
 */
export const FATAL_ERROR_CODES: readonly BackendErrorCode[] = [
  BACKEND_ERROR_CODES.PARTICIPANT_NOT_FOUND,
  BACKEND_ERROR_CODES.CHATROOM_NOT_FOUND,
  BACKEND_ERROR_CODES.SESSION_INVALID,
  BACKEND_ERROR_CODES.NOT_AUTHENTICATED,
  BACKEND_ERROR_CODES.UNAUTHORIZED,
  BACKEND_ERROR_CODES.FORBIDDEN,
  BACKEND_ERROR_CODES.ACCESS_DENIED,
  BACKEND_ERROR_CODES.AUTH_FAILED,
  BACKEND_ERROR_CODES.NO_GOOGLE_ACCOUNT,
  BACKEND_ERROR_CODES.GOOGLE_ACCOUNT_IN_USE,
  BACKEND_ERROR_CODES.USER_TYPE_MISMATCH,
  BACKEND_ERROR_CODES.INVALID_USER_TYPE,
  BACKEND_ERROR_CODES.FEATURE_DISABLED,
] as const;

/**
 * Error codes that are non-fatal — the CLI logs a warning but continues running.
 * These represent transient or expected conditions (race conditions, stale data).
 */
export const NON_FATAL_ERROR_CODES: readonly BackendErrorCode[] = [
  // Context
  BACKEND_ERROR_CODES.CONTEXT_NO_HANDOFF_SINCE_LAST_CONTEXT,
  BACKEND_ERROR_CODES.CONTEXT_NOT_FOUND,
  BACKEND_ERROR_CODES.CONTEXT_RESTRICTED,
  BACKEND_ERROR_CODES.HANDOFF_RESTRICTED,

  // Not found (recoverable)
  BACKEND_ERROR_CODES.BACKLOG_ITEM_NOT_FOUND,
  BACKEND_ERROR_CODES.TASK_NOT_FOUND,
  BACKEND_ERROR_CODES.QUEUED_MESSAGE_NOT_FOUND,
  BACKEND_ERROR_CODES.ITEM_NOT_FOUND,
  BACKEND_ERROR_CODES.MESSAGE_NOT_FOUND,
  BACKEND_ERROR_CODES.CONTEXT_NOT_FOUND,
  BACKEND_ERROR_CODES.SAVED_COMMAND_NOT_FOUND,
  BACKEND_ERROR_CODES.RUN_NOT_FOUND,
  BACKEND_ERROR_CODES.COMMAND_NOT_FOUND,
  BACKEND_ERROR_CODES.ATTENDANCE_NOT_FOUND,
  BACKEND_ERROR_CODES.USER_NOT_FOUND,
  BACKEND_ERROR_CODES.NOT_FOUND,

  // Validation (recoverable with different input)
  BACKEND_ERROR_CODES.CONTENT_EMPTY,
  BACKEND_ERROR_CODES.REASON_EMPTY,
  BACKEND_ERROR_CODES.NAME_REQUIRED,
  BACKEND_ERROR_CODES.COMMAND_NAME_EMPTY,
  BACKEND_ERROR_CODES.MISSING_CLASSIFICATION,
  BACKEND_ERROR_CODES.MESSAGE_NOT_CLASSIFIED,
  BACKEND_ERROR_CODES.INVALID_CONTENT,
  BACKEND_ERROR_CODES.INVALID_ROLE,
  BACKEND_ERROR_CODES.INVALID_TASK,
  BACKEND_ERROR_CODES.INVALID_TASK_STATUS,
  BACKEND_ERROR_CODES.INVALID_ITEM,
  BACKEND_ERROR_CODES.INVALID_ITEM_STATUS,
  BACKEND_ERROR_CODES.INVALID_MESSAGE,
  BACKEND_ERROR_CODES.INVALID_STATE,
  BACKEND_ERROR_CODES.INVALID_CONVERSION,
  BACKEND_ERROR_CODES.INVALID_STDIN_FORMAT,
  BACKEND_ERROR_CODES.INVALID_BOT_TOKEN,
  BACKEND_ERROR_CODES.INVALID_STATE_TRANSITION,
  BACKEND_ERROR_CODES.TASK_INVALID_TRANSITION,
  BACKEND_ERROR_CODES.TASK_MISSING_REQUIRED_FIELD,
  BACKEND_ERROR_CODES.TASK_VALIDATION_FAILED,
  BACKEND_ERROR_CODES.BACKLOG_INVALID_TRANSITION,
  BACKEND_ERROR_CODES.BACKLOG_ITEM_WRONG_CHATROOM,
  BACKEND_ERROR_CODES.BACKLOG_MISSING_REQUIRED_FIELD,
  BACKEND_ERROR_CODES.BACKLOG_VALIDATION_FAILED,
  BACKEND_ERROR_CODES.SKILL_NOT_FOUND_OR_DISABLED,
  BACKEND_ERROR_CODES.MISSING_FEATURE_METADATA,
  BACKEND_ERROR_CODES.MISSING_SPECIFICATION,
  BACKEND_ERROR_CODES.MISSING_STDIN,
  BACKEND_ERROR_CODES.UNKNOWN_PARAM,
  BACKEND_ERROR_CODES.VALIDATION_ERROR,
  BACKEND_ERROR_CODES.OUTPUT_CHUNK_TOO_LARGE,
  BACKEND_ERROR_CODES.TOO_MANY_COMMANDS,
  BACKEND_ERROR_CODES.COMMAND_NOT_DISCOVERED,
  BACKEND_ERROR_CODES.COMMAND_NOT_RUNNING,
  BACKEND_ERROR_CODES.RUN_WRONG_MACHINE,
  BACKEND_ERROR_CODES.COMMAND_TYPE_IMMUTABLE,
  BACKEND_ERROR_CODES.NOT_AUTHORIZED_MACHINE,
  BACKEND_ERROR_CODES.ATTENDANCE_DELETE_UNAUTHORIZED,

  // Conflict
  BACKEND_ERROR_CODES.CONFLICT,
  BACKEND_ERROR_CODES.EMAIL_ALREADY_EXISTS,
  BACKEND_ERROR_CODES.ALREADY_CONNECTED,
  BACKEND_ERROR_CODES.CONNECT_ERROR,
  BACKEND_ERROR_CODES.UNSAFE_DISCONNECT,
  BACKEND_ERROR_CODES.CONFIGURATION_ERROR,
  BACKEND_ERROR_CODES.CHATROOM_NO_TEAM_ID,
  BACKEND_ERROR_CODES.TEAM_REQUIRED,

  // Integration
  BACKEND_ERROR_CODES.WEBHOOK_REGISTRATION_FAILED,
  BACKEND_ERROR_CODES.WEBHOOK_REMOVAL_FAILED,
  BACKEND_ERROR_CODES.OAUTH_ERROR,
  BACKEND_ERROR_CODES.LOGIN_ERROR,

  // Workflow
  BACKEND_ERROR_CODES.WORKFLOW_REQUIRED,

  // Direct Harness Sessions
  BACKEND_ERROR_CODES.HARNESS_SESSION_INVALID_AGENT,
  BACKEND_ERROR_CODES.HARNESS_SESSION_INVALID_PROMPT,
  BACKEND_ERROR_CODES.HARNESS_SESSION_CLOSED,
  BACKEND_ERROR_CODES.HARNESS_SESSION_UNKNOWN_AGENT,
] as const;

/**
 * Structured response from getPendingTasksForRole subscription.
 * Replaces thrown exceptions with typed responses the CLI can switch on.
 *
 * The backend never throws — it always returns one of these variants:
 *
 * - `tasks`: Pending/acknowledged tasks available for the role
 * - `no_tasks`: No tasks available, keep waiting
 * - `grace_period`: Recently acknowledged task within recovery window
 * - `superseded`: Another get-next-task process took over this role
 * - `reconnect`: Backend wants the CLI to restart its connection
 * - `error`: A structured error with a code, message, and fatality flag
 */
export type GetNextTaskResponse =
  | {
      type: 'tasks';
      tasks: {
        task: Record<string, unknown>;
        message: Record<string, unknown> | null;
      }[];
    }
  | { type: 'no_tasks' }
  | { type: 'grace_period'; taskId: string; remainingMs: number }
  | { type: 'superseded'; newConnectionId: string }
  | { type: 'reconnect'; reason: string }
  | {
      type: 'error';
      code: BackendErrorCode;
      message: string;
      fatal: boolean;
    };

/** @deprecated Use GetNextTaskResponse instead */
export type WaitForTaskResponse = GetNextTaskResponse;
