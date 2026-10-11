/**
 * Shared types for external (machine-installed) Agent Skills discovery.
 *
 * External skills are SKILL.md directories installed outside the chatroom
 * backend (e.g. `~/.agents/skills/<name>/SKILL.md`). They are discovered by the
 * CLI process on the local machine and never written to the backend.
 */

/** A directory that is scanned for external skills. */
export interface ExternalSkillRoot {
  /** Absolute path to the root directory. */
  path: string;
}

/** A successfully discovered and validated external skill. */
export interface ExternalSkill {
  /** Equals the frontmatter `name` and the directory entry name. */
  skillId: string;
  /** Same as `skillId` (the spec `name`). */
  name: string;
  /** Trimmed frontmatter description. */
  description: string;
  /** Realpath of the skill directory. Relative references in the skill resolve here. */
  skillDir: string;
  /** `<root>/<entry>` as discovered, before realpath resolution. */
  sourcePath: string;
  /** SKILL.md content after the frontmatter, with leading blank lines trimmed. */
  body: string;
}

export type ExternalSkillIssueReason =
  | 'root-unreadable'
  | 'root-truncated'
  | 'unreadable'
  | 'too-large'
  | 'missing-frontmatter'
  | 'invalid-frontmatter'
  | 'invalid-name'
  | 'name-mismatch'
  | 'invalid-description'
  | 'shadowed'
  | 'builtin-collision';

/** A non-fatal problem encountered during discovery. */
export interface ExternalSkillIssue {
  path: string;
  reason: ExternalSkillIssueReason;
  /** Extra context (error code, winning path, etc.). Raw, unsanitized. */
  detail?: string;
}

export interface ExternalSkillDiscovery {
  skills: ExternalSkill[];
  issues: ExternalSkillIssue[];
}

export interface ExternalSkillsOps {
  discover(): Promise<ExternalSkillDiscovery>;
}
