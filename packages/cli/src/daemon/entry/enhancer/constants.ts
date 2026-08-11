export const ENHANCER_AGENT_ROLE = 'enhancer';
export const ENHANCER_AGENT_END_GRACE_MS = 3_000;
// No duration timeout on enhancer jobs — they resolve on a terminal backend
// outcome, agent exit, or salvage failure.
