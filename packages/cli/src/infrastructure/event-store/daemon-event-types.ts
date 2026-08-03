/**
 * Convex event variant strings for daemon-originated mutations.
 *
 * These MUST match the `type:` literal the backend derives inside each
 * `machines.ts` / `events.ts` handler. Keep in sync with
 * `services/backend/convex/schema.ts` `chatroom_eventStream` literals.
 */
export const DAEMON_EVENT_TYPES = {
  AGENT_EXITED: 'agent.exited',
  AGENT_STARTED: 'agent.started',
  AGENT_START_FAILED: 'agent.startFailed',
  AGENT_REGISTERED: 'agent.registered',
  AGENT_SESSION_RESUME_REQUESTED: 'agent.sessionResumeRequested',
  AGENT_SESSION_RESUMED: 'agent.sessionResumed',
  AGENT_SESSION_RESUME_FAILED: 'agent.sessionResumeFailed',
  AGENT_SESSION_REOPEN_RETRY: 'agent.sessionReopenRetry',
  AGENT_SESSION_AUGMENTED: 'agent.sessionAugmented',
  AGENT_HARNESS_SESSION_ID_UPDATED: 'agent.harnessSessionIdUpdated',
  AGENT_STOP_TIMEOUT: 'agent.stopTimeout',
  AGENT_RESTART_LIMIT_REACHED: 'agent.restartLimitReached',
  AGENT_RESTART_PHASE: 'agent.restartPhase',
  AGENT_RESTART_COMPLETED: 'agent.restartCompleted',
  AGENT_TASK_DELIVERED: 'agent.taskDelivered',
  AGENT_TASK_DELIVERY_FAILED: 'agent.taskDeliveryFailed',
} as const;
