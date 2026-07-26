/** One loop iteration when enhancer is enabled for the chatroom. */
export const ENHANCER_DELEGATION_ROUND_WORKFLOW =
  'planner → enhancer → planner → builder → planner';

/** Full user-instruction flow when enhancer is enabled. */
export const ENHANCER_ENABLED_USER_WORKFLOW = `user → [loop ${ENHANCER_DELEGATION_ROUND_WORKFLOW}] → user`;

/** Full user-instruction flow when enhancer is disabled. */
export const ENHANCER_DISABLED_USER_WORKFLOW = 'user → [loop planner → builder → planner] → user';
