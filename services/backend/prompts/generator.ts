/**
 * Prompt Generator
 *
 * Architecture:
 *
 * LOW-LEVEL GENERATORS (building blocks):
 *   - generateGeneralInstructions() — general behavioral instructions
 *     (future: customizable per chatroom / user level)
 *     Currently used by the CLI envelope (wait-for-task.ts) for the init header.
 *   - generateRolePrompt() — role-specific identity, guidance, workflow, and commands
 *     (used on every wait-for-task message to combat context rot)
 *
 * FINAL OUTPUT COMPOSERS (compose low-level generators for specific delivery modes):
 *   - composeSystemPrompt() — full agent setup prompt (role identity, getting started,
 *     classification guide, workflow guidance, commands, next steps).
 *     For harnesses that allow specifying the system prompt.
 *   - composeInitMessage() — first user message (reserved for future use)
 *   - composeInitPrompt() — returns all three forms so the caller can choose
 *
 * Note: General instructions (wait-for-task guidance) are provided by the CLI
 * envelope (wait-for-task.ts), NOT embedded in server-side prompts, to avoid
 * duplication.
 */

import { handoffCommand } from './base/cli/handoff/command.js';
import {
  getTaskStartedPrompt,
  getTaskStartedPromptForHandoffRecipient,
  getContextGainingGuidance,
} from './base/cli/index.js';
import { reportProgressCommand } from './base/cli/report-progress/command.js';
import { getBuilderGuidance as getBaseBuilderGuidance } from './base/cli/roles/builder.js';
import { getPlannerGuidance as getBasePlannerGuidance } from './base/cli/roles/planner.js';
import { getReviewerGuidance as getBaseReviewerGuidance } from './base/cli/roles/reviewer.js';
import { waitForTaskCommand } from './base/cli/wait-for-task/command.js';
import {
  getWaitForTaskGuidance,
  getWaitForTaskReminder,
} from './base/cli/wait-for-task/reminder.js';
import { getBuilderGuidance as getPairBuilderGuidance } from './teams/pair/prompts/builder.js';
import { getReviewerGuidance as getPairReviewerGuidance } from './teams/pair/prompts/reviewer.js';
import { getBuilderGuidance as getSquadBuilderGuidance } from './teams/squad/prompts/builder.js';
import { getPlannerGuidance as getSquadPlannerGuidance } from './teams/squad/prompts/planner.js';
import { getReviewerGuidance as getSquadReviewerGuidance } from './teams/squad/prompts/reviewer.js';
import { getRoleTemplate } from './templates';
import { getCliEnvPrefix } from './utils/index.js';

// Guidelines and policies are exported for external use
// They can be included in review prompts as needed
export { getReviewGuidelines } from './teams/pair/roles';
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
  // Currently returns the wait-for-task guidance as the core general instruction.
  // Future: merge with chatroom-level and user-level custom instructions.
  const sections: string[] = [];

  sections.push(getWaitForTaskGuidance());

  return sections.join('\n\n');
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Detect team type from team configuration
 */
function detectTeamType(teamRoles: string[], teamName?: string): 'pair' | 'squad' | 'unknown' {
  const normalizedName = (teamName || '').toLowerCase();
  if (normalizedName.includes('squad')) return 'squad';
  if (normalizedName.includes('pair')) return 'pair';

  // Detect by role composition
  const hasPlanner = teamRoles.some((r) => r.toLowerCase() === 'planner');
  if (hasPlanner) return 'squad';

  const hasBuilder = teamRoles.some((r) => r.toLowerCase() === 'builder');
  const hasReviewer = teamRoles.some((r) => r.toLowerCase() === 'reviewer');
  if (hasBuilder && hasReviewer && teamRoles.length === 2) return 'pair';

  // 'unknown' is intentional: custom teams get generic base guidance rather than
  // pair-specific rules which could impose incorrect handoff constraints.
  // Base guidance provides safe defaults for any team structure.
  return 'unknown';
}

/**
 * Get team-specific role guidance
 */
function getTeamRoleGuidance(
  role: string,
  teamRoles: string[],
  isEntryPoint: boolean,
  convexUrl: string,
  teamName?: string,
  availableMembers?: string[]
): string | null {
  const normalizedRole = role.toLowerCase();
  const teamType = detectTeamType(teamRoles, teamName);

  try {
    if (teamType === 'squad') {
      if (normalizedRole === 'planner') {
        return getSquadPlannerGuidance({
          role,
          teamRoles,
          isEntryPoint,
          convexUrl,
          availableMembers,
        });
      }
      if (normalizedRole === 'builder') {
        return getSquadBuilderGuidance({ role, teamRoles, isEntryPoint, convexUrl });
      }
      if (normalizedRole === 'reviewer') {
        return getSquadReviewerGuidance({ role, teamRoles, isEntryPoint, convexUrl });
      }
    }

    if (teamType === 'pair') {
      if (normalizedRole === 'builder') {
        return getPairBuilderGuidance({ role, teamRoles, isEntryPoint, convexUrl });
      }
      if (normalizedRole === 'reviewer') {
        return getPairReviewerGuidance({ role, teamRoles, isEntryPoint, convexUrl });
      }
    }
  } catch {
    // Fall back to base guidance
  }

  return null;
}

/**
 * Get base role guidance
 */
function getBaseRoleGuidance(
  role: string,
  teamRoles: string[],
  isEntryPoint: boolean,
  convexUrl: string
): string {
  const normalizedRole = role.toLowerCase();

  if (normalizedRole === 'planner') {
    return getBasePlannerGuidance({ role, teamRoles, isEntryPoint, convexUrl });
  }
  if (normalizedRole === 'builder') {
    return getBaseBuilderGuidance({ role, teamRoles, isEntryPoint, convexUrl });
  }
  if (normalizedRole === 'reviewer') {
    return getBaseReviewerGuidance({ role, teamRoles, isEntryPoint, convexUrl });
  }

  return '';
}

export interface RolePromptContext {
  chatroomId: string;
  role: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  currentClassification?: 'question' | 'new_feature' | 'follow_up' | null;
  availableHandoffRoles: string[];
  canHandoffToUser: boolean;
  restrictionReason?: string | null;
  convexUrl: string; // Required Convex URL for env var prefix generation
  /** Currently available (waiting) team members for dynamic workflow adaptation */
  availableMembers?: string[];
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
 */
export function generateRolePrompt(ctx: RolePromptContext): string {
  const template = getRoleTemplate(ctx.role);
  const normalizedRole = ctx.role.toLowerCase();
  const entryPoint = ctx.teamEntryPoint || ctx.teamRoles[0] || 'builder';
  const isEntryPoint = normalizedRole === entryPoint.toLowerCase();

  const sections: string[] = [];

  // Role header
  sections.push(`## Your Role: ${template.title.toUpperCase()}`);
  sections.push(template.description);

  // Role-specific guidance (team-aware)
  const teamGuidance = getTeamRoleGuidance(
    ctx.role,
    ctx.teamRoles,
    isEntryPoint,
    ctx.convexUrl,
    ctx.teamName,
    ctx.availableMembers
  );
  if (teamGuidance) {
    sections.push(teamGuidance);
  } else {
    // Fall back to base guidance
    sections.push(getBaseRoleGuidance(ctx.role, ctx.teamRoles, isEntryPoint, ctx.convexUrl));
  }

  // Current task context
  if (ctx.currentClassification) {
    sections.push(getClassificationContext(ctx.currentClassification));
  }

  // Available handoff options
  sections.push(getHandoffSection(ctx));

  // Commands reference
  sections.push(getCommandsSection(ctx));

  return sections.join('\n\n');
}

function getClassificationContext(
  classification: 'question' | 'new_feature' | 'follow_up'
): string {
  const info: Record<typeof classification, { label: string; description: string }> = {
    question: {
      label: 'QUESTION',
      description: 'User is asking a question. Can respond directly after answering.',
    },
    new_feature: {
      label: 'NEW FEATURE',
      description: 'New functionality request. MUST go through reviewer before returning to user.',
    },
    follow_up: {
      label: 'FOLLOW-UP',
      description: 'Follow-up to previous task. Same rules as the original apply.',
    },
  };

  const { label, description } = info[classification];
  return `### Current Task: ${label}\n${description}`;
}

function getHandoffSection(ctx: RolePromptContext): string {
  const roles = ctx.availableHandoffRoles.join(', ');
  let section = `### Handoff Options\nAvailable targets: ${roles}`;

  if (!ctx.canHandoffToUser && ctx.restrictionReason) {
    section += `\n\n⚠️ **Restriction:** ${ctx.restrictionReason}`;
  }

  return section;
}

function getCommandsSection(ctx: RolePromptContext): string {
  const cliEnvPrefix = getCliEnvPrefix(ctx.convexUrl);

  const handoffCmd = handoffCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    nextRole: '<target>',
    cliEnvPrefix,
  });

  const waitCmd = waitForTaskCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    cliEnvPrefix,
  });

  const progressCmd = reportProgressCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    cliEnvPrefix,
  });

  return `### Commands

**Complete task and hand off:**

\`\`\`bash
${handoffCmd}
\`\`\`

Replace \`[Your message here]\` with:
- **Summary**: Brief description of what was done
- **Changes Made**: Key changes (bullets)
- **Testing**: How to verify the work

**Report progress on current task:**

\`\`\`bash
${progressCmd}
\`\`\`

Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

**Continue receiving messages after \`handoff\`:**
\`\`\`
${waitCmd}
\`\`\`

${getWaitForTaskReminder()}`;
}

/**
 * Generate a focused reminder for task-started based on role + classification.
 * Returns a short, specific prompt reminding the agent of the expected action.
 */
export function generateTaskStartedReminder(
  role: string,
  classification: 'question' | 'new_feature' | 'follow_up',
  chatroomId: string,
  messageId?: string,
  taskId?: string,
  convexUrl?: string,
  teamRoles: string[] = [],
  teamName?: string
): string {
  const normalizedRole = role.toLowerCase();
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  const teamType = detectTeamType(teamRoles, teamName);

  // Detect if this is a pair team (builder + reviewer)
  const isPairTeam = teamType === 'pair';
  const isSquadTeam = teamType === 'squad';

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
        return `✅ Task acknowledged as QUESTION.

**Next steps:**
1. Answer the user's question
2. When done, hand off to user:

\`\`\`bash
${handoffToUserCmd}
\`\`\`

💡 You're working on:
${messageId ? `Message ID: ${messageId}` : `Task ID: ${taskId}`}`;
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
        return `✅ Task acknowledged as NEW FEATURE.

**Next steps:**
1. Decompose the task into clear, actionable work items
2. Delegate implementation to ${delegateTarget}:

\`\`\`bash
${handoffToTeamCmd}
\`\`\`

3. Review completed work before delivering to user
4. Hand back for rework if requirements are not met

💡 You're working on:
${messageId ? `Message ID: ${messageId}` : `Task ID: ${taskId}`}`;
      }
      case 'follow_up': {
        return `✅ Task acknowledged as FOLLOW UP.

**Next steps:**
1. Review the follow-up request against previous work
2. Delegate to appropriate team member or handle yourself
3. Follow-up inherits the workflow rules from the original task:
   - If original was a QUESTION → handle and hand off to user when done
   - If original was a NEW FEATURE → delegate, review, and deliver to user

💡 You're working on:
${messageId ? `Message ID: ${messageId}` : `Task ID: ${taskId}`}`;
      }
    }
  }

  // Builder-specific reminders
  if (normalizedRole === 'builder') {
    if (isPairTeam) {
      // Pair team: explicit handoff instructions based on classification
      switch (classification) {
        case 'question': {
          const handoffToUserCmd = handoffCommand({
            chatroomId,
            role: 'builder',
            nextRole: 'user',
            cliEnvPrefix,
          });
          const progressCmd = reportProgressCommand({
            chatroomId,
            role: 'builder',
            cliEnvPrefix,
          });
          return `✅ Task acknowledged as QUESTION.

**Next steps:**
1. Send a progress update: \`${progressCmd}\`
2. Answer the user's question
3. When done, hand off directly to user:

\`\`\`bash
${handoffToUserCmd}
\`\`\`

💡 You're working on:
${messageId ? `Message ID: ${messageId}` : `Task ID: ${taskId}`}`;
        }
        case 'new_feature': {
          const handoffToReviewerCmd = handoffCommand({
            chatroomId,
            role: 'builder',
            nextRole: 'reviewer',
            cliEnvPrefix,
          });
          return `✅ Task acknowledged as NEW FEATURE.

**Next steps:**
1. Implement the feature
2. Send \`report-progress\` at milestones (e.g., after major changes, when blocked)
3. Commit your changes
4. MUST hand off to reviewer for approval:

\`\`\`bash
${handoffToReviewerCmd}
\`\`\`

💡 You're working on:
${messageId ? `Message ID: ${messageId}` : `Task ID: ${taskId}`}`;
        }
        case 'follow_up': {
          return `✅ Task acknowledged as FOLLOW UP.

**Next steps:**
1. Complete the follow-up work
2. Send \`report-progress\` at milestones for visibility
3. Follow-up inherits the workflow rules from the original task:
   - If original was a QUESTION → hand off to user when done
   - If original was a NEW FEATURE → hand off to reviewer when done

💡 You're working on:
${messageId ? `Message ID: ${messageId}` : `Task ID: ${taskId}`}`;
        }
      }
    } else if (isSquadTeam) {
      // Squad team: builder hands off to reviewer or planner, never to user
      const hasReviewer = teamRoles.some((r) => r.toLowerCase() === 'reviewer');
      const handoffTarget = hasReviewer ? 'reviewer' : 'planner';
      const handoffCmd = handoffCommand({
        chatroomId,
        role: 'builder',
        nextRole: handoffTarget,
        cliEnvPrefix,
      });
      return `✅ Task acknowledged as ${classification.toUpperCase().replace('_', ' ')}.

**Next steps:**
1. Implement the requested changes
2. Send \`report-progress\` at milestones
3. Hand off to ${handoffTarget} when complete:

\`\`\`bash
${handoffCmd}
\`\`\`

⚠️ In squad team, never hand off directly to user — go through the planner.

💡 You're working on:
${messageId ? `Message ID: ${messageId}` : `Task ID: ${taskId}`}`;
    } else {
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
${messageId ? `Message ID: ${messageId}` : `Task ID: ${taskId}`}`;
    }
  }

  // Reviewer should run task-started to acknowledge receipt
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
    // Pair team or generic: hand off to user when approved
    if (taskId) {
      return `Review the completed work. If the user's goal is met, hand off to user. If not, provide specific feedback and hand off to builder.

💡 You're reviewing:
Task ID: ${taskId}`;
    }
    return `Review the work and approve or request changes.`;
  }

  // Generic fallback for unknown roles
  return `Proceed with your task and hand off when complete.`;
}

// =============================================================================
// FINAL OUTPUT COMPOSERS
// =============================================================================

export interface InitPromptInput {
  chatroomId: string;
  role: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  convexUrl: string; // Required Convex URL for env var prefix generation
  /** Currently available (waiting) team members. Falls back to teamRoles if not provided. */
  availableMembers?: string[];
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
  /** Init message: context-gaining instructions and task-started guidance (first user message) */
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
 * Note: General instructions (wait-for-task guidance) are NOT included here
 * because the CLI envelope (wait-for-task.ts) already provides them in the
 * initialization header. Including them here would cause duplication.
 */
export function composeSystemPrompt(input: InitPromptInput): string {
  const { chatroomId, role, teamName, teamRoles, teamEntryPoint, convexUrl } = input;
  const template = getRoleTemplate(role);
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  const entryPoint = teamEntryPoint || teamRoles[0] || 'builder';
  const isEntryPoint = role.toLowerCase() === entryPoint.toLowerCase();
  const teamType = detectTeamType(teamRoles, teamName);

  const otherRoles = teamRoles.filter((r) => r.toLowerCase() !== role.toLowerCase());

  // In squad team, only the planner can hand off to the user
  const canHandoffToUser = teamType === 'squad' ? role.toLowerCase() === 'planner' : true;
  const handoffTargets = canHandoffToUser
    ? [...new Set([...otherRoles, 'user'])]
    : [...new Set(otherRoles)];

  const roleCtx: RolePromptContext = {
    chatroomId,
    role,
    teamName,
    teamRoles,
    teamEntryPoint,
    currentClassification: null,
    availableHandoffRoles: handoffTargets,
    canHandoffToUser,
    restrictionReason: canHandoffToUser
      ? null
      : 'In squad team, only the planner can hand off to the user.',
    convexUrl,
  };

  const guidance =
    getTeamRoleGuidance(
      role,
      teamRoles,
      isEntryPoint,
      convexUrl,
      teamName,
      input.availableMembers
    ) ?? getBaseRoleGuidance(role, teamRoles, isEntryPoint, convexUrl);

  const waitCmd = waitForTaskCommand({ chatroomId, role, cliEnvPrefix });

  const sections: string[] = [];

  // Team header and role identity
  sections.push(`# ${teamName}`);
  sections.push(`## Your Role: ${template.title.toUpperCase()}`);
  sections.push(template.description);

  // Context-gaining: Getting Started commands (context read, wait-for-task)
  sections.push(getContextGainingGuidance({ chatroomId, role, convexUrl }));

  // Task classification / acknowledgement commands
  if (isEntryPoint) {
    sections.push(getTaskStartedPrompt({ chatroomId, role, cliEnvPrefix }));
  } else {
    sections.push(getTaskStartedPromptForHandoffRecipient({ chatroomId, role, cliEnvPrefix }));
  }

  // Role-specific guidance (team-aware workflow)
  sections.push(guidance);

  // Handoff options (includes restriction notice for squad non-planner roles)
  sections.push(getHandoffSection(roleCtx));

  // Command reference (handoff, progress, wait-for-task)
  sections.push(getCommandsSection(roleCtx));

  // Next step
  sections.push(`### Next\n\nRun:\n\n\`\`\`bash\n${waitCmd}\n\`\`\``);

  return sections
    .filter((s) => s.trim())
    .join('\n\n')
    .trim();
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
 *   - `initMessage` — first user message (context-gaining, task-started, next steps)
 *   - `initPrompt` — combined single message (for harnesses without system prompt support)
 */
export function composeInitPrompt(input: InitPromptInput): ComposedInitPrompt {
  const systemPrompt = composeSystemPrompt(input);
  const initMessage = composeInitMessage(input);
  // Combined prompt: system prompt + init message (if non-empty)
  const initPrompt = initMessage ? `${systemPrompt}\n\n${initMessage}` : systemPrompt;

  return { systemPrompt, initMessage, initPrompt };
}
