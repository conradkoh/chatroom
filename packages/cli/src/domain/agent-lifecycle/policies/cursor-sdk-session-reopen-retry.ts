/** Fixed-interval session reopen retries for cursor-sdk native harness crash recovery. */
export const CURSOR_SDK_SESSION_REOPEN_MAX_ATTEMPTS = 20;
export const CURSOR_SDK_SESSION_REOPEN_INTERVAL_MS = 5_000;
export const CURSOR_SDK_SESSION_REOPEN_REASON = 'platform.cursor_sdk_session_reopen';
/** Resume existing harness session for this many reopen attempts after run-error before cold restart. */
export const CURSOR_SDK_SESSION_RESUME_FIRST_ATTEMPTS = 3;
