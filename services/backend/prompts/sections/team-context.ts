/**
 * Team Context Section
 *
 * Standalone section producing the team-specific context block
 * (squad rules, pair rules, etc.) from a SelectorContext.
 *
 * Phase 2 of the prompt engineering architecture refactor.
 * See docs/prompt-engineering/design.md
 */

import type { SelectorContext, PromptSection } from '../types/sections';
import { createSection } from '../types/sections';

/**
 * Generate the team context knowledge section.
 *
 * This is the "Squad Team Context" or "Pair Team Context" block that
 * sits before the base role guidance. It provides team-specific rules
 * (e.g., "NEVER hand off directly to user" for squad).
 */
export function getTeamContextSection(ctx: SelectorContext): PromptSection {
  if (ctx.team === 'squad') {
    return createSection('team-context', 'knowledge', getSquadContext(ctx));
  }

  if (ctx.team === 'duo') {
    return createSection('team-context', 'knowledge', getDuoContext(ctx));
  }

  if (ctx.team === 'pair') {
    return createSection('team-context', 'knowledge', getPairContext(ctx));
  }

  // Unknown team — no team context
  return createSection('team-context', 'knowledge', '');
}

function getSquadContext(ctx: SelectorContext): string {
  const normalizedRole = ctx.role.toLowerCase();

  if (normalizedRole === 'planner') {
    return getSquadPlannerContext(ctx);
  }
  if (normalizedRole === 'builder') {
    return getSquadBuilderContext();
  }
  if (normalizedRole === 'reviewer') {
    return getSquadReviewerContext(ctx);
  }

  return '';
}

function getSquadPlannerContext(_ctx: SelectorContext): string {
  return `**Squad Team Context:**
 - You coordinate a team of builder and reviewer
 - You are the ONLY role that communicates directly with the user
 - You are ultimately accountable for all work quality
 - You manage the backlog and prioritize tasks
 - Team members may go offline at any time — adapt by handling their responsibilities yourself if needed`;
}

function getSquadBuilderContext(): string {
  return `**Squad Team Context:**
 - You work with a planner who coordinates the team and communicates with the user
 - You do NOT communicate directly with the user — hand off to the planner instead
 - Focus on implementation, the planner or reviewer will handle quality checks
 - After completing work, hand off to reviewer (if available) or planner
 - **NEVER hand off directly to \`user\`** — always go through the planner`;
}

function getSquadReviewerContext(_ctx: SelectorContext): string {
  return `**Squad Team Context:**
 - You work with a planner who coordinates the team and communicates with the user
 - You do NOT communicate directly with the user — hand off to the planner instead
 - Focus on code quality and requirements
 - Provide constructive feedback to builder or planner
 - If work meets requirements → hand off to \`planner\` for user delivery
 - If changes needed → hand off to \`builder\` with specific feedback (or implement yourself if builder is unavailable)
 - **NEVER hand off directly to \`user\`** — always go through the planner`;
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
 - Builder may go offline at any time — if unavailable, implement changes yourself
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

function getPairContext(ctx: SelectorContext): string {
  const normalizedRole = ctx.role.toLowerCase();

  if (normalizedRole === 'builder') {
    return `**Pair Team Context:**
 - You work with a reviewer who will check your code
 - Focus on implementation, let reviewer handle quality checks
 - Hand off to reviewer for all code changes`;
  }

  if (normalizedRole === 'reviewer') {
    return `**Pair Team Context:**
 - You work with a builder who implements code
 - Focus on code quality and requirements
 - Provide constructive feedback to builder
 - If the user's goal is met → hand off to user
 - If changes are needed → hand off to builder with specific feedback`;
  }

  return '';
}
