/**
 * Team Context Section
 *
 * Standalone section producing the team-specific context block
 * (duo rules, etc.) from a SelectorContext.
 *
 * Phase 2 of the prompt engineering architecture refactor.
 * See docs/prompt-engineering/design.md
 */

import type { SelectorContext, PromptSection } from '../types/sections';
import { createSection } from '../types/sections';

/**
 * Generate the team context knowledge section.
 *
 * This is the "Duo Team Context" block that sits before the base role guidance.
 * It provides team-specific rules (e.g., "NEVER hand off directly to user" for duo).
 */
export function getTeamContextSection(ctx: SelectorContext): PromptSection {
  if (ctx.team === 'duo') {
    return createSection('team-context', 'knowledge', getDuoContext(ctx));
  }

  // Unknown team — no team context
  return createSection('team-context', 'knowledge', '');
}

function getDuoContext(ctx: SelectorContext): string {
  const normalizedRole = ctx.role.toLowerCase();

  if (normalizedRole === 'planner') {
    return getDuoPlannerContext(ctx);
  }
  if (normalizedRole === 'builder') {
    return getDuoBuilderContext();
  }

  return '';
}

function getDuoPlannerContext(_ctx: SelectorContext): string {
  return `**Duo Team Context:**
 - You are the entry point — you communicate directly with the user
 - You coordinate with the builder for implementation tasks
 - You are ultimately accountable for all work quality
 - Builder may go offline at any time — if unavailable when code work is needed, report the situation to the user
 - After reviewing builder output, deliver results to the user
 - **Only you can hand off to \`user\`**`;
}

function getDuoBuilderContext(): string {
  return `**Duo Team Context:**
 - You work with a planner who coordinates work and communicates with the user
 - You do NOT communicate directly with the user — hand off to the planner instead
 - Focus on implementation; the planner handles user communication and delivery
 - After completing work, hand off back to planner
 - **NEVER hand off directly to \`user\`** — always go through the planner`;
}
