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
export function isDaemonOrchestrationP3Enabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P3);
}

/** DAEMON_ORCHESTRATION_P3_LOCAL_DELIVERY — delivery from local handoff event (P3 PR D optional) */
// fallow-ignore-next-line unused-export
export function isDaemonOrchestrationP3LocalDeliveryEnabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P3_LOCAL_DELIVERY);
}

/** DAEMON_ORCHESTRATION_P4 — APM emits local lifecycle events; projection batches emit* to Convex */
export function isDaemonOrchestrationP4Enabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P4);
}

/** DAEMON_ORCHESTRATION_P5 — inbound-only Convex subscribers; publisher registry outbox-only */
export function isDaemonOrchestrationP5Enabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P5);
}

/** DAEMON_ORCHESTRATION_P6 — master umbrella for CLI migration sub-flags. */
// fallow-ignore-next-line unused-export
export function isDaemonOrchestrationP6Enabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P6);
}

/** DAEMON_ORCHESTRATION_P6_GET_NEXT_TASK — get-next-task claim via daemon HTTP. */
export function isDaemonOrchestrationP6GetNextTaskEnabled(): boolean {
  return (
    envTruthy(process.env.DAEMON_ORCHESTRATION_P6_GET_NEXT_TASK) || isDaemonOrchestrationP6Enabled()
  );
}

/** DAEMON_ORCHESTRATION_P6_MESSAGES — messages reads via daemon HTTP. */
export function isDaemonOrchestrationP6MessagesEnabled(): boolean {
  return (
    envTruthy(process.env.DAEMON_ORCHESTRATION_P6_MESSAGES) || isDaemonOrchestrationP6Enabled()
  );
}

/** DAEMON_ORCHESTRATION_P6_CONTEXT — context read via daemon HTTP. */
export function isDaemonOrchestrationP6ContextEnabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P6_CONTEXT) || isDaemonOrchestrationP6Enabled();
}

/** DAEMON_ORCHESTRATION_P6_TASK_READ — task read via daemon HTTP. */
export function isDaemonOrchestrationP6TaskReadEnabled(): boolean {
  return (
    envTruthy(process.env.DAEMON_ORCHESTRATION_P6_TASK_READ) || isDaemonOrchestrationP6Enabled()
  );
}

/** DAEMON_ORCHESTRATION_P7 — user-message intent feed replaces snapshot WS for wake (subscriber + ingest). */
export function isDaemonOrchestrationP7Enabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P7);
}
