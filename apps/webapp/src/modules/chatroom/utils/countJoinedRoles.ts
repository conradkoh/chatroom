interface SetupParticipant {
  role: string;
  lastSeenAt?: number | null;
}

/** Count how many team roles have an online participant (lastSeenAt set). */
export function countJoinedRoles(teamRoles: string[], participants: SetupParticipant[]): number {
  const participantMap = new Map(participants.map((p) => [p.role.toLowerCase(), p]));
  return teamRoles.filter((role) => {
    const p = participantMap.get(role.toLowerCase());
    return p != null && p.lastSeenAt != null;
  }).length;
}
