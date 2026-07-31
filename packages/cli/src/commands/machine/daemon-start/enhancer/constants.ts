export const ENHANCER_AGENT_ROLE = 'enhancer';
export const ENHANCER_AGENT_END_GRACE_MS = 3_000;
export const ENHANCER_JOB_POLL_INTERVAL_MS = 500;
// No duration timeout on enhancer jobs — they only resolve on actual completion,
// agent exit, or salvage failure. ENHANCER_SILENCE_TIMEOUT_MS was removed.
