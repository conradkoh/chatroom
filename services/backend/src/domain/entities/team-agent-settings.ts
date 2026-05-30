/**
 * Per-team, per-role agent setting availability.
 *
 * Controls which roles can configure optional agent settings in the UI.
 */

/** Roles that may configure "auto restart on new context" for now. */
export const AUTO_RESTART_ON_NEW_CONTEXT_ROLES = ['builder'] as const;

/** Whether the given role can expose the auto-restart-on-new-context setting. */
export function roleSupportsAutoRestartOnNewContextSetting(role: string): boolean {
  const normalized = role.toLowerCase();
  return AUTO_RESTART_ON_NEW_CONTEXT_ROLES.some((r) => r === normalized);
}
