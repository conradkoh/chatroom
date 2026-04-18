/**
 * Skill Types — Single source of truth for skill-related types.
 *
 * All skills are defined once in the SKILLS map below.
 * Skill IDs (kebab-case, used by CLI/registry) and customization types
 * (snake_case, stored in DB) are both derived from that single definition.
 *
 * The schema (convex/schema.ts) maintains its own v.literal() definition
 * for runtime validation — do not remove those.
 */

// ─── Skills Map (single source of truth) ────────────────────────────────

/**
 * Each skill is defined once here.
 * - Key: skill ID (kebab-case), used by the CLI and skill registry.
 * - customizationType: the DB-stored type for chatroom_skillCustomizations,
 *   or null if the skill does not support customization.
 */
const SKILLS = {
  'backlog':              { customizationType: null },
  'software-engineering': { customizationType: null },
  'code-review':          { customizationType: null },
  'workflow':             { customizationType: null },
  'development-workflow': { customizationType: 'development_workflow' as const },
  'release-workflow':     { customizationType: null },
} as const satisfies Record<string, { customizationType: string | null }>;

// ─── Skill IDs ───────────────────────────────────────────────────────────

/** Union type of all registered skill IDs. */
export type SkillId = keyof typeof SKILLS;

/** All registered skill IDs, in definition order. */
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];

/** Check if a string is a valid skill ID. */
export function isSkillId(value: string): value is SkillId {
  return value in SKILLS;
}

// ─── Skill Customization Types ───────────────────────────────────────────

/** Union type of all skill customization types (DB-stored, snake_case). */
export type SkillCustomizationType = NonNullable<
  (typeof SKILLS)[SkillId]['customizationType']
>;

/** Named constant for the development workflow customization type. */
export const DEVELOPMENT_WORKFLOW_CUSTOMIZATION_TYPE =
  SKILLS['development-workflow'].customizationType;

/**
 * All supported skill customization types.
 * Derived from SKILLS map — no duplication needed.
 * @deprecated Prefer named constants (e.g. DEVELOPMENT_WORKFLOW_CUSTOMIZATION_TYPE).
 */
export const SKILL_CUSTOMIZATION_TYPES = (
  Object.values(SKILLS)
    .map((s) => s.customizationType)
    .filter((t): t is SkillCustomizationType => t !== null)
) as readonly SkillCustomizationType[];

/**
 * Mapping from skill ID to customization type.
 * Derived from SKILLS map — no duplication needed.
 * @deprecated Prefer getSkillCustomizationType().
 */
export const SKILL_ID_TO_CUSTOMIZATION_TYPE: Record<string, SkillCustomizationType> =
  Object.fromEntries(
    Object.entries(SKILLS)
      .filter((entry): entry is [string, { customizationType: SkillCustomizationType }] =>
        entry[1].customizationType !== null
      )
      .map(([id, s]) => [id, s.customizationType])
  );

/**
 * Get the customization type for a given skill ID.
 * Returns null if the skill does not support customization.
 */
export function getSkillCustomizationType(skillId: string): SkillCustomizationType | null {
  const skill = (SKILLS as Record<string, { customizationType: string | null }>)[skillId];
  return (skill?.customizationType as SkillCustomizationType | null) ?? null;
}
