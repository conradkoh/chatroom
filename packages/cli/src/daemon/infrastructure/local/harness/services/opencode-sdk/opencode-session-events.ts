export const OPENCODE_SESSION_EVENT_TYPES = [
  'session.idle',
  'session.provider_id',
  'session.updated',
] as const;
export type OpenCodeSessionEventType = (typeof OPENCODE_SESSION_EVENT_TYPES)[number];

export function isOpenCodeSessionEventType(value: string): value is OpenCodeSessionEventType {
  return (OPENCODE_SESSION_EVENT_TYPES as readonly string[]).includes(value);
}
