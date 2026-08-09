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
