/**
 * Prompt Generator
 *
 * Architecture:
 *
 * LOW-LEVEL GENERATORS (building blocks):
 *   - generateGeneralInstructions() — general behavioral instructions
 *     (future: customizable per chatroom / user level)
 *     Currently used by the CLI envelope (get-next-task.ts) for the init header.
 *   - generateRolePrompt() — role-specific identity, guidance, workflow, and commands
 *     (used on every get-next-task message to combat context rot)
 *
 * FINAL OUTPUT COMPOSERS (compose low-level generators for specific delivery modes):
 *   - composeSystemPrompt() — full agent setup prompt (role identity, getting started,
 *     classification guide, workflow guidance, commands, next steps).
 *     For harnesses that allow specifying the system prompt.
 *   - composeInitMessage() — first user message (reserved for future use)
 *   - composeInitPrompt() — returns all three forms so the caller can choose
 *
 * Note: General instructions (get-next-task guidance) are provided by the CLI
 * envelope (get-next-task.ts), NOT embedded in server-side prompts, to avoid
 * duplication.
 */

import { getNextTaskCommand } from './cli/get-next-task/command';
import { getNextTaskGuidance } from './cli/get-next-task/reminder';
import { handoffCommand } from './cli/handoff/command';
import { reportProgressCommand } from './cli/report-progress/command';
import { getBaseRoleGuidanceFromContext } from './cli/roles/fromContext';
import { getHandoffTemplatesPreviewSection } from './cli/sections/handoff-templates-preview';
import { getClassificationGuideSection } from './sections/classification-guide';
import { getCommandsReferenceSection } from './sections/commands-reference';
import { getCurrentClassificationSection } from './sections/current-classification';
import { getGettingStartedSection } from './sections/getting-started';
import { getGlossarySection } from './sections/glossary';
import { getHandoffOptionsSection } from './sections/handoff-options';
import { getNextStepSection } from './sections/next-step';
import { getRoleGuidanceSection } from './sections/role-guidance';
import {
  getTeamHeaderSection,
  getRoleTitleSection,
  getRoleDescriptionSection,
} from './sections/role-identity';
import { getSessionVsChatroomTaskSection } from './sections/session-vs-chatroom-task';
import { getDuoRoleGuidanceFromContext } from './teams/duo/prompts/fromContext';
import { getSoloRoleGuidanceFromContext } from './teams/solo/prompts/fromContext';
import { getSquadRoleGuidanceFromContext } from './teams/squad/prompts/fromContext';
// getRoleTemplate is now used by section modules (role-identity.ts, role-guidance fromContext adapters)
import type { SelectorContext, PromptSection } from './types/sections';
import { composeSections } from './types/sections';
import { getCliEnvPrefix } from './utils/index';
import { getTeamEntryPoint, toTeam } from '../src/domain/entities/team';
import type { TeamKind } from '../src/domain/entities/team-kind';

// Guidelines and policies are exported for external use
// They can be included in review prompts as needed
export { getReviewGuidelines } from './review-guidelines';
export { getSecurityPolicy } from './policies/security';
export { getDesignPolicy } from './policies/design';
export { getPerformancePolicy } from './policies/performance';

// =============================================================================
// LOW-LEVEL GENERATORS
// =============================================================================

export interface GeneralInstructionsInput {
  /** Chatroom-level custom instructions (future: user-configurable) */
  chatroomInstructions?: string;
}

/**
 * Generate general behavioral instructions for agents.
 *
 * This is the lowest-level prompt building block — it provides general
 * behavioral directives that apply regardless of the agent's role.
 *
 * Future: This will be customizable at the chatroom and user level.
 */
export function generateGeneralInstructions(_input?: GeneralInstructionsInput): string {
  // Currently returns the get-next-task guidance as the core general instruction.
  // Future: merge with chatroom-level and user-level custom instructions.
  const sections: string[] = [];

  sections.push(getNextTaskGuidance());

  return sections.join('\n\n');
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Detect team type from team configuration
 */
function detectTeamType(teamRoles: string[], teamName?: string): TeamKind | 'unknown' {
  const normalizedName = (teamName || '').toLowerCase();
  if (normalizedName.includes('solo')) return 'solo';
  if (normalizedName.includes('squad')) return 'squad';
  if (normalizedName.includes('duo')) return 'duo';
  // Detect by role composition
  const hasPlanner = teamRoles.some((r) => r.toLowerCase() === 'planner');
  const hasBuilder = teamRoles.some((r) => r.toLowerCase() === 'builder');
  const hasReviewer = teamRoles.some((r) => r.toLowerCase() === 'reviewer');
  const hasSolo = teamRoles.some((r) => r.toLowerCase() === 'solo');

  // Solo: single solo role
  if (hasSolo && teamRoles.length === 1) return 'solo';

  // Duo: planner + builder (exactly 2 roles, no reviewer)
  if (hasPlanner && hasBuilder && !hasReviewer && teamRoles.length === 2) return 'duo';

  // Squad: has planner (with more than 2 roles or with reviewer)
  if (hasPlanner) return 'squad';

  // 'unknown' is intentional: custom teams get generic base guidance.
  // Base guidance provides safe defaults for any team structure.
  return 'unknown';
}

// Note: getTeamRoleGuidance and getBaseRoleGuidance were removed in Phase 3.
// Their functionality is now handled by getRoleGuidanceFromContext which uses
// SelectorContext-based dispatching through the fromContext adapters.

// =============================================================================
// SELECTOR-CONTEXT BASED DISPATCHERS (Phase 1.2/1.3)
// =============================================================================

/**
 * Build a SelectorContext from the various parameters used in the generator.
 *
 * This is the bridge from the current "spread of arguments" pattern to the
 * unified SelectorContext type. As callers migrate, they can construct
 * SelectorContext directly instead of going through this helper.
 */
export function buildSelectorContext(params: {
  role: string;
  teamRoles: string[];
  teamName?: string;
  teamId?: string;
  teamEntryPoint?: string;
  convexUrl: string;
  chatroomId?: string;
  workflow?: 'new_feature' | 'question' | 'follow_up' | null;
  agentType?: 'remote' | 'custom' | 'unset';
}): SelectorContext {
  const entryPoint =
    getTeamEntryPoint({ teamEntryPoint: params.teamEntryPoint, teamRoles: params.teamRoles }) ??
    'builder';
  const teamConfig =
    toTeam({
      teamId: params.teamId,
      teamName: params.teamName,
      teamRoles: params.teamRoles,
      teamEntryPoint: params.teamEntryPoint,
    }) ?? undefined;
  return {
    role: params.role,
    team: detectTeamType(params.teamRoles, params.teamName),
    teamConfig,
    workflow: params.workflow,
    teamRoles: params.teamRoles,
    isEntryPoint: params.role.toLowerCase() === entryPoint.toLowerCase(),
    convexUrl: params.convexUrl,
    chatroomId: params.chatroomId,
    agentType: params.agentType ?? 'unset',
  };
}

/**
 * Get role guidance using SelectorContext-based dispatching.
 *
 * Follows the same team → base fallback pattern as getTeamRoleGuidance/getBaseRoleGuidance
 * but uses the unified SelectorContext type throughout.
 *
 * This is the new preferred entry point for getting role guidance.
 */
export function getRoleGuidanceFromContext(ctx: SelectorContext): string {
  try {
    if (ctx.team === 'solo') {
      const result = getSoloRoleGuidanceFromContext(ctx);
      if (result !== null) return result;
    }

    if (ctx.team === 'squad') {
      const result = getSquadRoleGuidanceFromContext(ctx);
      if (result !== null) return result;
    }

    if (ctx.team === 'duo') {
      const result = getDuoRoleGuidanceFromContext(ctx);
      if (result !== null) return result;
    }
  } catch {
    // Fall back to base guidance
  }

  return getBaseRoleGuidanceFromContext(ctx);
}

// =============================================================================
// ROLE PROMPT GENERATION
// =============================================================================

export interface RolePromptContext {
  chatroomId: string;
  role: string;
  teamId?: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  currentClassification?: 'question' | 'new_feature' | 'follow_up' | null;
  availableHandoffRoles: string[];
  convexUrl: string; // Required Convex URL for env var prefix generation
  // User context for reviewers - the original request that needs to be validated
  userContext?: {
    originalRequest: string;
    featureTitle?: string;
    featureDescription?: string;
    techSpecs?: string;
  };
}

/**
 * Generate a role-specific prompt for the given context.
 * This is called on every message to provide fresh context.
 *
 * Uses PromptSection[] assembly for traceability and composability.
 */
export function generateRolePrompt(ctx: RolePromptContext): string {
  // Build SelectorContext for unified dispatching
  const selectorCtx = buildSelectorContext({
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    teamId: ctx.teamId,
    teamName: ctx.teamName,
    teamEntryPoint: ctx.teamEntryPoint,
    convexUrl: ctx.convexUrl,
    chatroomId: ctx.chatroomId,
    workflow: ctx.currentClassification,
  });

  const sections: PromptSection[] = [];

  // Role identity
  sections.push(getRoleTitleSection(selectorCtx));
  sections.push(getRoleDescriptionSection(selectorCtx));
  sections.push(getGlossarySection({ convexUrl: ctx.convexUrl ?? '', chatroomId: ctx.chatroomId }));

  // Role-specific guidance (team-aware)
  sections.push(getRoleGuidanceSection(selectorCtx));

  // Current task context
  if (ctx.currentClassification) {
    sections.push(getCurrentClassificationSection(ctx.currentClassification));
  }

  // Available handoff options
  sections.push(
    getHandoffOptionsSection({
      availableHandoffRoles: ctx.availableHandoffRoles,
    })
  );

  // Commands reference
  sections.push(
    getCommandsReferenceSection({
      chatroomId: ctx.chatroomId,
      role: ctx.role,
      convexUrl: ctx.convexUrl,
    })
  );

  return composeSections(sections);
}

// Note: getClassificationContext, getHandoffSection, and getCommandsSection were
// replaced by PromptSection-producing functions in sections/ directory.
// See sections/current-classification.ts, sections/handoff-options.ts,
// sections/commands-reference.ts

/**
 * Generate a focused reminder for classify/task-read based on role + classification.
 * Returns a short, specific prompt reminding the agent of the expected action.
 *
 * Uses SelectorContext internally for team/role detection (Phase 4).
 */
export function generateTaskStartedReminder(
  role: string,
  classification: 'question' | 'new_feature' | 'follow_up',
  chatroomId: string,
  _messageId?: string,
  taskId?: string,
  convexUrl?: string,
  teamRoles: string[] = [],
  teamName?: string
): string {
  // Build SelectorContext for consistent team/role detection (Phase 4)
  const ctx = buildSelectorContext({
    role,
    teamRoles,
    teamName,
    convexUrl: convexUrl ?? '',
    chatroomId,
    workflow: classification,
  });

  const normalizedRole = role.toLowerCase();
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  const isSquadTeam = ctx.team === 'squad';
  const isDuoTeam = ctx.team === 'duo';

  // Planner-specific reminders (squad team)
  if (normalizedRole === 'planner') {
    switch (classification) {
      case 'question': {
        const handoffToUserCmd = handoffCommand({
          chatroomId,
          role: 'planner',
          nextRole: 'user',
          cliEnvPrefix,
        });
        return `✅ Chatroom task acknowledged as QUESTION.

**Next steps:**
1. Answer the user's question
2. When done, hand off to user:

\`\`\`bash
${handoffToUserCmd}
\`\`\`

💡 You're working on:
Task ID: ${taskId}`;
      }
      case 'new_feature': {
        const hasBuilder = teamRoles.some((r) => r.toLowerCase() === 'builder');
        const delegateTarget = hasBuilder ? 'builder' : 'reviewer';
        const handoffToTeamCmd = handoffCommand({
          chatroomId,
          role: 'planner',
          nextRole: delegateTarget,
          cliEnvPrefix,
        });
        const progressCmd = reportProgressCommand({
          chatroomId,
          role: 'planner',
          cliEnvPrefix,
        });
        return `✅ Chatroom task acknowledged as NEW FEATURE.

**Next steps:**
1. Decompose the chatroom task into clear, actionable work items
2. **Report progress to the user** before delegating — so they know work has started:

\`\`\`bash
${progressCmd}
\`\`\`

3. Delegate implementation to ${delegateTarget}:

\`\`\`bash
${handoffToTeamCmd}
\`\`\`

4. When work returns, send another \`report-progress\` update before reviewing
5. Review completed work before delivering to user
6. Hand back for rework if requirements are not met

💡 You're working on:
Task ID: ${taskId}`;
      }
      case 'follow_up': {
        const progressCmdFollowUp = reportProgressCommand({
          chatroomId,
          role: 'planner',
          cliEnvPrefix,
        });
        return `✅ Chatroom task acknowledged as FOLLOW UP.

**Next steps:**
1. Review the follow-up request against previous work
2. **Report progress to the user** so they know you're handling it:

\`\`\`bash
${progressCmdFollowUp}
\`\`\`

3. Delegate to appropriate team member or handle yourself
4. Follow-up inherits the workflow rules from the original chatroom task:
   - If original was a QUESTION → handle and hand off to user when done
   - If original was a NEW FEATURE → delegate, review, and deliver to user

💡 You're working on:
Task ID: ${taskId}`;
      }
    }
  }

  // Builder-specific reminders
  if (normalizedRole === 'builder') {
    if (isSquadTeam) {
      // Squad team: builder hands off to reviewer or planner, never to user
      const hasReviewer = teamRoles.some((r) => r.toLowerCase() === 'reviewer');
      const handoffTarget = hasReviewer ? 'reviewer' : 'planner';
      const handoffCmd = handoffCommand({
        chatroomId,
        role: 'builder',
        nextRole: handoffTarget,
        cliEnvPrefix,
      });
      return `✅ Chatroom task acknowledged as ${classification.toUpperCase().replace('_', ' ')}.

**Next steps:**
1. Implement the requested changes
2. Send \`report-progress\` at milestones
3. Hand off to ${handoffTarget} when complete:

\`\`\`bash
${handoffCmd}
\`\`\`

⚠️ In squad team, never hand off directly to user — go through the planner.

💡 You're working on:
Task ID: ${taskId}`;
    }
    if (isDuoTeam) {
      // Duo team: builder always hands off to planner, never to user
      const handoffCmd = handoffCommand({
        chatroomId,
        role: 'builder',
        nextRole: 'planner',
        cliEnvPrefix,
      });
      return `✅ Chatroom task acknowledged as ${classification.toUpperCase().replace('_', ' ')}.

**Next steps:**
1. Implement the requested changes
2. Send \`report-progress\` at milestones
3. Hand off to planner when complete:

\`\`\`bash
${handoffCmd}
\`\`\`

⚠️ In duo team, never hand off directly to user — go through the planner.

💡 You're working on:
Task ID: ${taskId}`;
    }
    // Generic builder reminder (no specific team structure)
    const handoffCmd = handoffCommand({
      chatroomId,
      role: 'builder',
      nextRole: '<target>',
      cliEnvPrefix,
    });
    return `You can proceed with your work and hand off when complete.

\`\`\`bash
${handoffCmd}
\`\`\`

💡 You're working on:
Task ID: ${taskId}`;
  }

  // Reviewer acknowledges receipt and reviews work
  if (normalizedRole === 'reviewer') {
    if (isSquadTeam) {
      // Squad team: reviewer hands off to planner, not user
      if (taskId) {
        return `Review the completed work. If the work meets requirements, hand off to planner for user delivery. If changes are needed, hand off to builder with specific feedback.

💡 You're reviewing:
Task ID: ${taskId}`;
      }
      return `Review the work. Hand off to planner when approved, or to builder for rework.`;
    }
    // Generic: hand off to user when approved
    if (taskId) {
      return `Review the completed work. If the user's goal is met, hand off to user. If not, provide specific feedback and hand off to builder.

💡 You're reviewing:
Task ID: ${taskId}`;
    }
    return `Review the work and approve or request changes.`;
  }

  // Solo agent reminders — plan, implement, and deliver independently
  if (normalizedRole === 'solo') {
    const handoffToUserCmd = handoffCommand({
      chatroomId,
      role: 'solo',
      nextRole: 'user',
      cliEnvPrefix,
    });
    const progressCmd = reportProgressCommand({
      chatroomId,
      role: 'solo',
      cliEnvPrefix,
    });

    switch (classification) {
      case 'question':
        return `✅ Chatroom task acknowledged as QUESTION.

**Next steps:**
1. Answer the user's question
2. When done, hand off directly to user:

\`\`\`bash
${handoffToUserCmd}
\`\`\`

💡 You're working on:
Task ID: ${taskId}`;
      case 'new_feature':
        return `✅ Chatroom task acknowledged as NEW FEATURE.

**Next steps:**
1. **Plan**: Decompose the chatroom task into actionable work items
2. **Report progress**: \`${progressCmd}\` — keep the user informed at milestones
3. **Implement**: Build the solution yourself using best practices
4. **Verify**: Run \`pnpm typecheck && pnpm test\` before delivering
5. **Deliver**: Hand off to user with a clear summary of what was done

\`\`\`bash
${handoffToUserCmd}
\`\`\`

💡 Use the workflow skill for multi-step tasks. You're working on:
Task ID: ${taskId}`;
      case 'follow_up':
        return `✅ Chatroom task acknowledged as FOLLOW UP.

**Next steps:**
1. Review the follow-up request against previous work
2. **Report progress**: \`${progressCmd}\` — let the user know you're handling it
3. Plan and implement the follow-up changes yourself
4. \`pnpm typecheck && pnpm test\` before delivering
5. Follow-up inherits workflow rules from the original chatroom task

💡 You're working on:
Task ID: ${taskId}`;
    }
  }

  // Generic fallback for unknown roles
  return `Proceed with your chatroom task and hand off when complete.`;
}

// =============================================================================
// FINAL OUTPUT COMPOSERS
// =============================================================================

export interface InitPromptInput {
  chatroomId: string;
  role: string;
  teamId?: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  convexUrl: string; // Required Convex URL for env var prefix generation
  /** Agent type for register-agent command — 'unset' produces `<remote|custom>` placeholder */
  agentType?: 'remote' | 'custom' | 'unset';
}

/**
 * Composed prompt result for agent initialization.
 *
 * Consumers choose the appropriate fields based on their delivery mode:
 *   - Machine mode (harness supports system prompt):
 *       use `systemPrompt` as the system prompt + `initMessage` as first user message
 *   - Manual mode (harness does NOT support system prompt override):
 *       use `initPrompt` which combines everything into a single message
 */
export interface ComposedInitPrompt {
  /** System prompt: general instructions + role prompt (for harnesses that support it) */
  systemPrompt: string;
  /** Init message: context-gaining instructions and classify guidance (first user message) */
  initMessage: string;
  /** Combined init prompt: everything in one message (for harnesses without system prompt) */
  initPrompt: string;
}

/**
 * Compose a system prompt for harnesses that support setting the system prompt.
 *
 * Contains the full agent setup: team header, role identity, context-gaining
 * instructions (Getting Started), task classification guide, role guidance,
 * and CLI commands. This matches the original init prompt structure.
 *
 * Note: General instructions (get-next-task guidance) are NOT included here
 * because the CLI envelope (get-next-task.ts) already provides them in the
 * initialization header. Including them here would cause duplication.
 */
export function composeSystemPrompt(input: InitPromptInput): string {
  const { chatroomId, role, teamId, teamName, teamRoles, teamEntryPoint, convexUrl } = input;

  // Build SelectorContext for unified dispatching
  const selectorCtx = buildSelectorContext({
    role,
    teamRoles,
    teamId,
    teamName,
    teamEntryPoint,
    convexUrl,
    chatroomId,
    agentType: input.agentType,
  });

  const otherRoles = teamRoles.filter((r) => r.toLowerCase() !== role.toLowerCase());
  const handoffTargets = [...new Set([...otherRoles, 'user'])];

  const sections: PromptSection[] = [];

  // Team header and role identity
  sections.push(getTeamHeaderSection(teamName));
  sections.push(getRoleTitleSection(selectorCtx));
  sections.push(getRoleDescriptionSection(selectorCtx));
  sections.push(getGlossarySection({ convexUrl: convexUrl ?? '', chatroomId }));

  // Session model: explains Level A (session) vs Level B (chatroom task) — high salience
  sections.push(getSessionVsChatroomTaskSection());

  // Context-gaining: Getting Started commands (context read, get-next-task)
  sections.push(getGettingStartedSection(selectorCtx));

  // Task classification / acknowledgement commands
  sections.push(getClassificationGuideSection(selectorCtx));

  // Role-specific guidance (team-aware workflow)
  sections.push(getRoleGuidanceSection(selectorCtx));

  sections.push(
    getHandoffTemplatesPreviewSection({
      teamId,
      role,
      handoffTargets,
    })
  );

  // Handoff options
  sections.push(
    getHandoffOptionsSection({
      availableHandoffRoles: handoffTargets,
    })
  );

  // Command reference (handoff, progress, get-next-task)
  sections.push(
    getCommandsReferenceSection({
      chatroomId,
      role,
      convexUrl,
    })
  );

  // Next step
  sections.push(getNextStepSection({ chatroomId, role, convexUrl }));

  return composeSections(sections);
}

/**
 * Generate the output shown after a successful handoff command.
 *
 * This is the prompt the agent sees after running `chatroom handoff`.
 * It confirms the handoff and reminds the agent to run `get-next-task`
 * to continue receiving messages.
 */
export function generateHandoffOutput(params: {
  role: string;
  nextRole: string;
  chatroomId: string;
  convexUrl?: string;
}): string {
  const { role, nextRole, chatroomId, convexUrl } = params;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  const lines: string[] = [];
  lines.push(`✅ Chatroom task completed and handed off to ${nextRole}`);
  lines.push('');
  lines.push('✅ Level B complete (chatroom task handed off).');
  lines.push(
    '⏳ Level A continues (session is still active) — run get-next-task to stay connected:'
  );
  lines.push('');
  lines.push(`\`${getNextTaskCommand({ chatroomId, role, cliEnvPrefix })}\``);

  return lines.join('\n');
}

/**
 * Compose an init message — the first user message sent to the agent.
 *
 * For the combined init prompt (harnesses without system prompt support),
 * this is appended after the system prompt. Currently empty since all
 * content is in the system prompt, but exists as an extension point for
 * future use (e.g., task-specific first messages).
 */
export function composeInitMessage(_input: InitPromptInput): string {
  // All initialization content is now in the system prompt.
  // The init message is reserved for future use (e.g., task-specific first messages).
  return '';
}

/**
 * Compose the full init prompt for agent initialization.
 *
 * Returns all three forms so the caller can choose based on harness capability:
 *   - `systemPrompt` — for harnesses that support system prompt (general instructions + role)
 *   - `initMessage` — first user message (context-gaining, classify, next steps)
 *   - `initPrompt` — combined single message (for harnesses without system prompt support)
 */
export function composeInitPrompt(input: InitPromptInput): ComposedInitPrompt {
  const systemPrompt = composeSystemPrompt(input);
  const initMessage = composeInitMessage(input);
  // Combined prompt: system prompt + init message (if non-empty)
  const initPrompt = initMessage ? `${systemPrompt}\n\n${initMessage}` : systemPrompt;

  return { systemPrompt, initMessage, initPrompt };
}

export {
  composeResumeMessage,
  type ComposeResumeMessageParams,
} from './cli/resume-session/message';
