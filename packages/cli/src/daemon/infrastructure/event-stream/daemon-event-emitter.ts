/**
 * Daemon-local audit event helper — routes structured events to SQLite via logEvent.
 */

export async function logDaemonAuditEvent(
  logEvent: (event: Record<string, unknown>) => Promise<void>,
  event: Record<string, unknown>
): Promise<void> {
  await logEvent({
    timestamp: Date.now(),
    ...event,
  });
}
