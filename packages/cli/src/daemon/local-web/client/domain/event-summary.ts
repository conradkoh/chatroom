const SUMMARY_KEYS = [
  'role',
  'message',
  'reason',
  'taskId',
  'agentId',
  'phase',
  'status',
  'harness',
] as const;
export function summarizeEventPayload(payload: Record<string, unknown>): string {
  for (const key of SUMMARY_KEYS) {
    const v = payload[key];
    if (typeof v === 'string' && v.trim()) return v.length > 80 ? `${v.slice(0, 77)}…` : v;
    if (typeof v === 'number') return String(v);
  }
  const skip = new Set(['type', 'timestamp', 'chatroomId', '_id']);
  for (const [k, v] of Object.entries(payload)) {
    if (skip.has(k) || v == null) continue;
    const line = `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`;
    return line.length > 80 ? `${line.slice(0, 77)}…` : line;
  }
  return '';
}
