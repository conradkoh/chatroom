/**
 * P8 daemon-orchestration flags — backend (Convex) runtime.
 *
 * These mirror the daemon-side helpers in
 * `packages/cli/src/daemon/infrastructure/projection/feature-flags.ts`.
 * The webapp MUST NOT read these — it uses data-driven chatroom fields only.
 */

export function isDaemonOrchestrationP8Enabled(): boolean {
  return process.env.DAEMON_ORCHESTRATION_P8 === '1';
}

export function isDaemonOrchestrationP8CutoverEnabled(): boolean {
  return process.env.DAEMON_ORCHESTRATION_P8_CUTOVER === '1';
}

/** DAEMON_ORCHESTRATION_P9 — master umbrella for P9 sink sub-flags. */
// fallow-ignore-next-line unused-export
export function isDaemonOrchestrationP9Enabled(): boolean {
  return process.env.DAEMON_ORCHESTRATION_P9 === '1';
}

export function isDaemonOrchestrationP9UserMessageEnabled(): boolean {
  return (
    process.env.DAEMON_ORCHESTRATION_P9_USER_MESSAGE === '1' || isDaemonOrchestrationP9Enabled()
  );
}

/** DAEMON_ORCHESTRATION_P9_QUEUE — local queue enqueue/promote (T2). */
// fallow-ignore-next-line unused-export
export function isDaemonOrchestrationP9QueueEnabled(): boolean {
  return process.env.DAEMON_ORCHESTRATION_P9_QUEUE === '1' || isDaemonOrchestrationP9Enabled();
}

/** DAEMON_ORCHESTRATION_P9_HANDOFF — remove Convex messages.handoff fallback (T3). */
// fallow-ignore-next-line unused-export
export function isDaemonOrchestrationP9HandoffEnabled(): boolean {
  return process.env.DAEMON_ORCHESTRATION_P9_HANDOFF === '1' || isDaemonOrchestrationP9Enabled();
}

/** DAEMON_ORCHESTRATION_P9_CLAIM — remove Convex tasks.claimTask fallback (T3). */
// fallow-ignore-next-line unused-export
export function isDaemonOrchestrationP9ClaimEnabled(): boolean {
  return process.env.DAEMON_ORCHESTRATION_P9_CLAIM === '1' || isDaemonOrchestrationP9Enabled();
}

export function isDaemonOrchestrationP9CutoverEnabled(): boolean {
  return process.env.DAEMON_ORCHESTRATION_P9_CUTOVER === '1';
}
