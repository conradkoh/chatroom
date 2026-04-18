/**
 * Skill Types — Single source of truth for skill-related types.
 *
 * This module provides type-safe constants and helpers for:
 * - Skill customization types (used in chatroom_skillCustomizations)
 * - Mapping between skill IDs and customization types
 *
 * The schema (convex/schema.ts) maintains its own v.literal() definition
 * for runtime validation. This module provides compile-time type safety.
 */

// ─── Skill Customization Types ───────────────────────────────────────────

/**
 * Named constants for each skill customization type.
 * Use these instead of string literals or array indices.
 */
export const DEVELOPMENT_WORKFLOW_CUSTOMIZATION_TYPE = 'development_workflow' as const;

/**
 * All supported skill customization types.
 * These correspond to the v.literal() values in convex/schema.ts.
 */
export const SKILL_CUSTOMIZATION_TYPES = [DEVELOPMENT_WORKFLOW_CUSTOMIZATION_TYPE] as const;

/**
 * Union type of all skill customization types.
 */
export type SkillCustomizationType = (typeof SKILL_CUSTOMIZATION_TYPES)[number];

// ─── Skill ID to Customization Type Mapping ─────────────────────────────

/**
 * Mapping from skill ID (as used in skill registry) to customization type.
 * Only skills that support customization are included.
 */
export const SKILL_ID_TO_CUSTOMIZATION_TYPE: Record<string, SkillCustomizationType> = {
  'development-workflow': DEVELOPMENT_WORKFLOW_CUSTOMIZATION_TYPE,
};

/**
 * Get the customization type for a given skill ID.
 * Returns null if the skill doesn't support customization.
 */
export function getSkillCustomizationType(skillId: string): SkillCustomizationType | null {
  return SKILL_ID_TO_CUSTOMIZATION_TYPE[skillId] ?? null;
}

// ─── Skill Registry Types ───────────────────────────────────────────────

/**
 * All registered skill IDs from the skill registry.
 * This provides a single source of truth for skill identification.
 */
export const SKILL_IDS = [
  'backlog',
  'software-engineering',
  'code-review',
  'workflow',
  'development-workflow',
  'release-workflow',
] as const;

/**
 * Union type of all registered skill IDs.
 */
export type SkillId = (typeof SKILL_IDS)[number];

/**
 * Check if a string is a valid skill ID.
 */
export function isSkillId(value: string): value is SkillId {
  return (SKILL_IDS as readonly string[]).includes(value);
}
