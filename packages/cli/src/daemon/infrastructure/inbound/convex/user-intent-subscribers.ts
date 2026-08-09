// fallow-ignore-file unused-file
/**
 * User-intent inbound Convex subscribers (P5).
 *
 * These are the ONLY Convex WS subscribers the daemon registers when
 * DAEMON_ORCHESTRATION_P5 is enabled — they carry user/webapp intent INTO the
 * daemon. Orchestration subscribers (assigned-task signals/presence,
 * enhancer-job) are removed because the daemon no longer subscribes to its own
 * projected state (handoff/lifecycle/enhancer are local-first under P3/P4).
 */
export const USER_INTENT_SUBSCRIBERS = [
  'git-request',
  'file-tree-request',
  'file-content-request',
  'file-write-request',
  'workspace-list',
  'command-events',
  'command-run',
  'direct-harness-session',
  'direct-harness-prompt',
  'direct-harness-command',
  'agentic-query-session',
  'agentic-query-prompt',
] as const;

/** Orchestration subscribers NOT registered when P5 is enabled. */
export const ORCHESTRATION_SUBSCRIBERS = [
  'assigned-task-signals',
  'assigned-task-presence',
  'enhancer-job',
] as const;
