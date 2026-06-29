/**
 * Per-team, per-role agent setting availability.
 *
 * Controls which roles can configure optional agent settings in the UI.
 */

/** Roles that receive session augmentation on native task delivery (builder only). */
export const SESSION_AUGMENTATION_ROLES = ['builder'] as const;

/** Whether the given role receives session augmentation on native task delivery. */
export function roleSupportsSessionAugmentation(role: string): boolean {
  const normalized = role.toLowerCase();
  return SESSION_AUGMENTATION_ROLES.some((r) => r === normalized);
}
