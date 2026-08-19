/** The one-time, request-first advisory pass for an originating user message. */
export const ENHANCER_REQUEST_FIRST_WORKFLOW = 'user → enhancer → planner';

/** Full user-instruction flow when enhancer is enabled. */
export const ENHANCER_ENABLED_USER_WORKFLOW = `${ENHANCER_REQUEST_FIRST_WORKFLOW} → [loop builder → planner] → user`;

/** Full user-instruction flow when enhancer is disabled. */
export const ENHANCER_DISABLED_USER_WORKFLOW = 'user → [loop planner → builder → planner] → user';
