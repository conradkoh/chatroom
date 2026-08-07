/**
 * Default wantResume when caller omits it.
 * Reconnect to last session is disabled by default for new chatrooms.
 */
export function resolveDefaultWantResume(_teamId: string, _role: string): boolean {
  return false;
}
