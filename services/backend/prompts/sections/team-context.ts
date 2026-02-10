/**
 * Team Context Section
 *
 * Standalone section producing the team-specific context block
 * (squad rules, pair rules, etc.) from a SelectorContext.
 *
 * Phase 2 of the prompt engineering architecture refactor.
 * See docs/prompt-engineering/design.md
 */

import type { SelectorContext, PromptSection } from '../types/sections.js';
import { createSection } from '../types/sections.js';

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

function getSquadPlannerContext(ctx: SelectorContext): string {
  const hasBuilder = (ctx.availableMembers ?? ctx.teamRoles).some(
    (r) => r.toLowerCase() === 'builder'
  );
  const hasReviewer = (ctx.availableMembers ?? ctx.teamRoles).some(
    (r) => r.toLowerCase() === 'reviewer'
  );

  return `**Squad Team Context:**
 - You coordinate a team of builder and reviewer
 - You are the ONLY role that communicates directly with the user
 - You are ultimately accountable for all work quality
 - You manage the backlog and prioritize tasks
 ${hasBuilder ? '- Builder is available for implementation tasks' : '- Builder is NOT available — you or the reviewer must implement'}
 ${hasReviewer ? '- Reviewer is available for code review' : '- Reviewer is NOT available — you must review work yourself'}`;
}

function getSquadBuilderContext(): string {
  return `**Squad Team Context:**
 - You work with a planner who coordinates the team and communicates with the user
 - You do NOT communicate directly with the user — hand off to the planner instead
 - Focus on implementation, the planner or reviewer will handle quality checks
 - After completing work, hand off to reviewer (if available) or planner
 - **NEVER hand off directly to \`user\`** — always go through the planner`;
}

function getSquadReviewerContext(ctx: SelectorContext): string {
  const hasBuilder = ctx.teamRoles.some((r) => r.toLowerCase() === 'builder');

  return `**Squad Team Context:**
 - You work with a planner who coordinates the team and communicates with the user
 - You do NOT communicate directly with the user — hand off to the planner instead
 - Focus on code quality and requirements
 - Provide constructive feedback to builder or planner
 ${hasBuilder ? '- Builder is available — hand back to builder for rework' : '- Builder is NOT available — you may also implement changes'}
 - If work meets requirements → hand off to \`planner\` for user delivery
 - If changes needed → hand off to \`builder\` with specific feedback${!hasBuilder ? ' (or implement yourself)' : ''}
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
