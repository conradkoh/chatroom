export type MessageViewMode = 'all' | 'user-only' | `role:${string}`;

export const ENHANCER_FILTER_ROLE = 'enhancer';

function rolesInclude(teamRoles: readonly string[], role: string): boolean {
  const needle = role.toLowerCase();
  return teamRoles.some((r) => r.toLowerCase() === needle);
}

/** Roles shown as filter tabs: user first, then team roles (deduped), then enhancer when planner team. */
export function getMessageFilterRoles(teamRoles: string[]): string[] {
  const roles = [
    ...new Set(['user', ...teamRoles.filter((role) => role.toLowerCase() !== 'user')]),
  ];
  if (rolesInclude(teamRoles, 'planner') && !rolesInclude(roles, ENHANCER_FILTER_ROLE)) {
    roles.push(ENHANCER_FILTER_ROLE);
  }
  return roles;
}

export function roleToMessageViewMode(role: string): MessageViewMode {
  return role.toLowerCase() === 'user' ? 'user-only' : (`role:${role}` as MessageViewMode);
}

export function messageViewModeToSenderRole(mode: MessageViewMode): string | null {
  if (mode === 'all') return null;
  if (mode === 'user-only') return 'user';
  if (mode.startsWith('role:')) return mode.slice(5);
  return null;
}

export function isFilteredMessageViewMode(
  mode: MessageViewMode
): mode is Exclude<MessageViewMode, 'all'> {
  return mode !== 'all';
}

function isRoleMessageViewMode(value: string): boolean {
  return value.startsWith('role:') && value.length > 5;
}

export function isValidMessageViewMode(v: unknown): v is MessageViewMode {
  if (v === 'all' || v === 'user-only') return true;
  return typeof v === 'string' && isRoleMessageViewMode(v);
}

/**
 * Whether a timeline message belongs in a role-filtered view.
 *
 * Must match listMessagesBySenderRolePaginated handler in messages.ts.
 */
// fallow-ignore-next-line complexity
export function messageMatchesSenderRoleFilter(
  message: { senderRole: string; type: string; targetRole?: string },
  senderRole: string
): boolean {
  if (senderRole.toLowerCase() === 'user') {
    if (message.senderRole.toLowerCase() === 'user' && message.type === 'message') return true;
    if (message.type === 'handoff' && message.targetRole?.toLowerCase() === 'user') return true;
    return false;
  }
  // Must match listMessagesBySenderRolePaginated enhancer branch in messages.ts
  if (senderRole.toLowerCase() === ENHANCER_FILTER_ROLE) {
    if (message.senderRole.toLowerCase() === ENHANCER_FILTER_ROLE) {
      return message.type === 'message' || message.type === 'handoff';
    }
    if (message.type === 'handoff' && message.targetRole?.toLowerCase() === ENHANCER_FILTER_ROLE) {
      return true;
    }
    return false;
  }
  if (message.senderRole.toLowerCase() !== senderRole.toLowerCase()) return false;
  return message.type === 'message' || message.type === 'handoff';
}

export function formatMessageViewRoleLabel(role: string): string {
  if (!role) return role;
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function messageViewModeTitle(mode: MessageViewMode): string {
  if (mode === 'all') return 'All messages';
  const role = messageViewModeToSenderRole(mode);
  return role ? `${formatMessageViewRoleLabel(role)} messages` : 'Filtered messages';
}
