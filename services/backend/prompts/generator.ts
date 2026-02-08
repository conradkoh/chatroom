/**
 * Prompt Generator
 *
 * Architecture:
 *
 * LOW-LEVEL GENERATORS (building blocks):
 *   - generateGeneralInstructions() — general behavioral instructions
 *     (future: customizable per chatroom / user level)
 *   - generateRolePrompt() — role-specific identity, guidance, workflow, and commands
 *
 * FINAL OUTPUT COMPOSERS (compose low-level generators for specific delivery modes):
 *   - composeSystemPrompt() — for harnesses that allow specifying the system prompt
 *     (e.g. machine mode: system prompt + first user message)
 *   - composeInitPrompt() — for harnesses that do NOT allow overriding the system prompt
 *     (e.g. manual mode: everything in a single init message)
 *
 * The role prompt is also refreshed on every wait-for-task to combat context rot.
 */

import { handoffCommand } from './base/cli/handoff/command.js';
import {
  getTaskStartedPrompt,
  getTaskStartedPromptForHandoffRecipient,
  getContextGainingGuidance,
} from './base/cli/index.js';
import { reportProgressCommand } from './base/cli/report-progress/command.js';
import { getBuilderGuidance as getBaseBuilderGuidance } from './base/cli/roles/builder.js';
import { getReviewerGuidance as getBaseReviewerGuidance } from './base/cli/roles/reviewer.js';
import { waitForTaskCommand } from './base/cli/wait-for-task/command.js';
import {
  getWaitForTaskGuidance,
  getWaitForTaskReminder,
} from './base/cli/wait-for-task/reminder.js';
import { getBuilderGuidance as getTeamBuilderGuidance } from './teams/pair/prompts/builder.js';
import { getReviewerGuidance as getTeamReviewerGuidance } from './teams/pair/prompts/reviewer.js';
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
 * Get team-specific role guidance
 */
function getTeamRoleGuidance(
  role: string,
  teamRoles: string[],
  isEntryPoint: boolean,
  convexUrl: string
): string | null {
  const normalizedRole = role.toLowerCase();

  try {
    if (normalizedRole === 'builder') {
      return getTeamBuilderGuidance({ role, teamRoles, isEntryPoint, convexUrl });
    }
    if (normalizedRole === 'reviewer') {
      return getTeamReviewerGuidance({ role, teamRoles, isEntryPoint, convexUrl });
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
  const teamGuidance = getTeamRoleGuidance(ctx.role, ctx.teamRoles, isEntryPoint, ctx.convexUrl);
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
  teamRoles: string[] = []
): string {
  const normalizedRole = role.toLowerCase();
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  // Detect if this is a pair team (builder + reviewer)
  const isPairTeam =
    teamRoles.length === 2 &&
    teamRoles.some((r) => r.toLowerCase() === 'builder') &&
    teamRoles.some((r) => r.toLowerCase() === 'reviewer');

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
    // Check if the task involves reviewing completed work
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
 * @deprecated Use `composeInitPrompt` instead. This alias is kept for backwards compatibility.
 */
export interface SplitInitPrompt {
  /** @deprecated Use ComposedInitPrompt.systemPrompt */
  rolePrompt: string;
  /** @deprecated Use ComposedInitPrompt.initMessage */
  initialMessage: string;
  /** @deprecated Use ComposedInitPrompt.initPrompt */
  combined: string;
}

/**
 * Compose a system prompt for harnesses that support setting the system prompt.
 *
 * Combines: general instructions + role prompt (team header, role identity,
 * guidance, commands).
 *
 * This is a pure composition of low-level generators.
 */
export function composeSystemPrompt(input: InitPromptInput): string {
  const { chatroomId, role, teamName, teamRoles, teamEntryPoint, convexUrl } = input;
  const template = getRoleTemplate(role);

  const entryPoint = teamEntryPoint || teamRoles[0] || 'builder';
  const isEntryPoint = role.toLowerCase() === entryPoint.toLowerCase();

  const otherRoles = teamRoles.filter((r) => r.toLowerCase() !== role.toLowerCase());
  const handoffTargets = [...new Set([...otherRoles, 'user'])];

  const roleCtx: RolePromptContext = {
    chatroomId,
    role,
    teamName,
    teamRoles,
    teamEntryPoint,
    currentClassification: null,
    availableHandoffRoles: handoffTargets,
    canHandoffToUser: true,
    restrictionReason: null,
    convexUrl,
  };

  const guidance =
    getTeamRoleGuidance(role, teamRoles, isEntryPoint, convexUrl) ??
    getBaseRoleGuidance(role, teamRoles, isEntryPoint, convexUrl);

  const sections: string[] = [];

  // General instructions (behavioral directives, wait-for-task guidance)
  sections.push(generateGeneralInstructions());

  // Role prompt (identity, guidance, commands)
  sections.push(`# ${teamName}`);
  sections.push(`## Your Role: ${template.title.toUpperCase()}`);
  sections.push(template.description);
  sections.push(guidance);
  sections.push(getCommandsSection(roleCtx));

  return sections
    .filter((s) => s.trim())
    .join('\n\n')
    .trim();
}

/**
 * Compose an init message — the first user message sent to the agent.
 *
 * Contains context-gaining instructions, task-started guidance, and
 * the command to begin listening for tasks.
 */
export function composeInitMessage(input: InitPromptInput): string {
  const { chatroomId, role, teamRoles, teamEntryPoint, convexUrl } = input;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  const entryPoint = teamEntryPoint || teamRoles[0] || 'builder';
  const isEntryPoint = role.toLowerCase() === entryPoint.toLowerCase();

  const waitCmd = waitForTaskCommand({ chatroomId, role, cliEnvPrefix });

  const sections: string[] = [];

  sections.push(getContextGainingGuidance({ chatroomId, role, convexUrl }));

  if (isEntryPoint) {
    sections.push(getTaskStartedPrompt({ chatroomId, role, cliEnvPrefix }));
  } else {
    sections.push(getTaskStartedPromptForHandoffRecipient({ chatroomId, role, cliEnvPrefix }));
  }

  sections.push(`### Next\n\nRun:\n\n\`\`\`bash\n${waitCmd}\n\`\`\``);

  return sections
    .filter((s) => s.trim())
    .join('\n\n')
    .trim();
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
  const initPrompt = `${systemPrompt}\n\n${initMessage}`;

  return { systemPrompt, initMessage, initPrompt };
}

/**
 * @deprecated Use `composeInitPrompt` instead.
 * Kept for backwards compatibility during migration.
 */
export function generateSplitInitPrompt(input: InitPromptInput): SplitInitPrompt {
  const composed = composeInitPrompt(input);
  return {
    rolePrompt: composed.systemPrompt,
    initialMessage: composed.initMessage,
    combined: composed.initPrompt,
  };
}
