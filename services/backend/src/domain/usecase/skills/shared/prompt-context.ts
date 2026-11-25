import type { SkillPromptContext } from '../registry';

/** Ids and roles are inlined into shell commands, so only plain tokens of at most 128 characters are accepted. */
const SAFE_REF = /^[A-Za-z0-9_-]{1,128}$/;
const HAS_ALPHANUMERIC = /[A-Za-z0-9]/;

export interface ResolvedSkillPromptRefs {
  cliEnvPrefix: string;
  chatroomId: string;
  role: string;
}

/** Return the value only when it is a plain token; anything else is unusable. */
function safeRef(value: string | undefined): string | undefined {
  return value && SAFE_REF.test(value) && HAS_ALPHANUMERIC.test(value) ? value : undefined;
}

/**
 * Resolve the values a skill prompt inlines into its commands.
 * Missing or unsafe values fall back to the `<id>` / `<role>` placeholders.
 */
export function resolveSkillPromptRefs(ctx: SkillPromptContext): ResolvedSkillPromptRefs {
  return {
    cliEnvPrefix: ctx.cliEnvPrefix,
    chatroomId: safeRef(ctx.chatroomId) ?? '<id>',
    role: safeRef(ctx.role) ?? '<role>',
  };
}
