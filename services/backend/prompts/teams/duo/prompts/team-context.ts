/**
 * Duo team context: the "Duo Team Context" rules block placed before duo role guidance.
 * Text is pinned by the duo characterisation snapshots. Do not reword it.
 */

import type { SelectorContext } from '../../../types/sections';

export function getDuoTeamContext(ctx: SelectorContext): string {
  const normalizedRole = ctx.role.toLowerCase();

  if (normalizedRole === 'planner') {
    return getDuoPlannerTeamContext();
  }
  if (normalizedRole === 'builder') {
    return getDuoBuilderTeamContext();
  }

  return '';
}

function getDuoPlannerTeamContext(): string {
  return `**Duo Team Context:**
 - You are the entry point — you communicate directly with the user
 - You coordinate with the builder for implementation tasks
 - You are ultimately accountable for all work quality
 - After reviewing builder work, complete any required review and verifier-gate steps before delivering results to the user
 - **Only you can hand off to \`user\`**`;
}

function getDuoBuilderTeamContext(): string {
  return `**Duo Team Context:**
 - You work with a planner who coordinates work and communicates with the user
 - You do NOT communicate directly with the user — hand off to the planner instead
 - Focus on implementation; the planner handles user communication and delivery
 - After completing work, hand off back to planner
 - **NEVER hand off directly to \`user\`** — always go through the planner`;
}
