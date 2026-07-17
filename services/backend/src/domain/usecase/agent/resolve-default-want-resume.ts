/**
 * Default wantResume when caller omits it.
 * Duo builder always cold-starts (delegation briefs use new_session).
 */
export function resolveDefaultWantResume(teamId: string, role: string): boolean {
  if (teamId.toLowerCase() === 'duo' && role.toLowerCase() === 'builder') {
    return false;
  }
  return true;
}
