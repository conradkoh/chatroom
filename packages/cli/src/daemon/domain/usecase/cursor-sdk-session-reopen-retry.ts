/** Fixed-interval session reopen retries for cursor-sdk native harness crash recovery. */
// fallow-ignore-next-line unused-export
export const CURSOR_SDK_SESSION_REOPEN_MAX_ATTEMPTS = 6;
// fallow-ignore-next-line unused-export
export const CURSOR_SDK_SESSION_REOPEN_INTERVAL_MS = 10_000;
// fallow-ignore-next-line unused-export
export const CURSOR_SDK_SESSION_REOPEN_REASON = 'platform.cursor_sdk_session_reopen';
/** Resume existing harness session for this many reopen attempts before cold restart. */
export const CURSOR_SDK_SESSION_RESUME_FIRST_ATTEMPTS = 3;
