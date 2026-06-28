/**
 * Returns a legible display title for a harness session.
 */
export function displaySessionTitle(s: {
  sessionTitle?: string | null;
  lastUsedConfig: { agent: string };
}): string {
  const t = s.sessionTitle?.trim();
  const isDefault = !t || /^new session\s*-\s*\d{4}-\d{2}-\d{2}t/i.test(t);
  if (isDefault) return s.lastUsedConfig.agent;
  return t;
}
