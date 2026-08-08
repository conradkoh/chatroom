function envTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

/** DAEMON_ORCHESTRATION_P1 — start outbox drain worker */
export function isDaemonOrchestrationP1Enabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P1);
}

/** DAEMON_ORCHESTRATION_P1_CUTOVER — drain worker writes to Convex; publisher-registry skips direct publish */
export function isDaemonOrchestrationP1CutoverEnabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P1_CUTOVER);
}

/** DAEMON_ORCHESTRATION_P2 — hydrate and shadow-sync local read models */
export function isDaemonOrchestrationP2Enabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P2);
}

/** DAEMON_ORCHESTRATION_P2_CUTOVER — task monitor reads local read models instead of Convex snapshot WS */
export function isDaemonOrchestrationP2CutoverEnabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P2_CUTOVER);
}

/** DAEMON_ORCHESTRATION_P3 — CLI handoff routes to daemon HTTP (wired in P3 PR D) */
// fallow-ignore-next-line unused-export
export function isDaemonOrchestrationP3Enabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P3);
}

/** DAEMON_ORCHESTRATION_P3_LOCAL_DELIVERY — delivery from local handoff event (P3 PR D optional) */
// fallow-ignore-next-line unused-export
export function isDaemonOrchestrationP3LocalDeliveryEnabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P3_LOCAL_DELIVERY);
}
