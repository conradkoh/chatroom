/**
 * Single merge point for builtin and external skills.
 *
 * Keeping precedence here means the command layer never reimplements it.
 * Pure: no I/O.
 */
import type { ExternalSkill, ExternalSkillDiscovery, ExternalSkillIssue } from './types.js';

/** Summary of a builtin skill as returned by the backend (`api.skills.list`). */
export interface BuiltinSkillSummary {
  skillId: string;
  name: string;
  description: string;
  type: string;
}

export interface SkillCatalog {
  /** Backend order, unchanged. */
  builtin: BuiltinSkillSummary[];
  /** Discovery order, with builtin collisions removed. */
  external: ExternalSkill[];
  /** Discovery issues first, then builtin-collision issues. */
  issues: ExternalSkillIssue[];
}

/**
 * Merge builtin and external skills. Builtins always take precedence over externals with the same id.
 */
export function mergeSkillCatalog(
  builtin: BuiltinSkillSummary[],
  discovery: ExternalSkillDiscovery
): SkillCatalog {
  const builtinIds = new Set(builtin.map((s) => s.skillId));

  const external: ExternalSkill[] = [];
  const collisionIssues: ExternalSkillIssue[] = [];
  for (const skill of discovery.skills) {
    if (builtinIds.has(skill.skillId)) {
      collisionIssues.push({
        path: skill.sourcePath,
        reason: 'builtin-collision',
        detail: `builtin "${skill.skillId}" takes precedence`,
      });
    } else {
      external.push(skill);
    }
  }

  return {
    builtin,
    external,
    issues: [...discovery.issues, ...collisionIssues],
  };
}

/** Look up an external skill by id in a merged catalog. */
export function findExternalSkill(
  catalog: SkillCatalog,
  skillId: string
): ExternalSkill | undefined {
  return catalog.external.find((s) => s.skillId === skillId);
}
