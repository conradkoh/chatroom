/**
 * Collapse multiple agent.requestStart events for the same chatroom+role to the
 * latest by timestamp. Prevents daemons from acting on stale duplicate starts
 * when users double-click or "start all" races with per-role starts.
 */
export function dedupeRequestStartEvents<
  T extends { chatroomId: unknown; role: string; timestamp: number },
>(events: readonly T[]): T[] {
  const latestByKey = new Map<string, T>();
  for (const evt of events) {
    const key = `${String(evt.chatroomId)}:${evt.role}`;
    const existing = latestByKey.get(key);
    if (!existing || evt.timestamp > existing.timestamp) {
      latestByKey.set(key, evt);
    }
  }
  return [...latestByKey.values()];
}
