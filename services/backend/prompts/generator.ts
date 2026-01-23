/**
 * Role Prompt Generator
 *
 * Generates role-specific prompts that are returned with each message.
 * These prompts are designed to be refreshed with every wait-for-task
 * to combat context rot in long conversations.
 */

import { handoffCommand } from './base/cli/handoff/command.js';
import { getTaskStartedPrompt } from './base/cli/index.js';
import { getBuilderGuidance as getBaseBuilderGuidance } from './base/cli/roles/builder.js';
import { getReviewerGuidance as getBaseReviewerGuidance } from './base/cli/roles/reviewer.js';
import { waitForTaskCommand } from './base/cli/wait-for-task/command.js';
import { getWaitForTaskReminder } from './base/cli/wait-for-task/reminder.js';
import { getBuilderGuidance as getTeamBuilderGuidance } from './teams/pair/prompts/builder.js';
import { getReviewerGuidance as getTeamReviewerGuidance } from './teams/pair/prompts/reviewer.js';
import { getRoleTemplate } from './templates';
import { HANDOFF_DIR, generateFilename, getCliEnvPrefix } from './utils/index.js';

// Guidelines and policies are exported for external use
// They can be included in review prompts as needed
export { getReviewGuidelines } from './teams/pair/roles';
export { getSecurityPolicy } from './policies/security';
export { getDesignPolicy } from './policies/design';
export { getPerformancePolicy } from './policies/performance';

/**
 * Get team-specific role guidance
 */
function getTeamRoleGuidance(
  role: string,
  teamRoles: string[],
  isEntryPoint: boolean
): string | null {
  const normalizedRole = role.toLowerCase();

  try {
    if (normalizedRole === 'builder') {
      return getTeamBuilderGuidance({ role, teamRoles, isEntryPoint });
    }
    if (normalizedRole === 'reviewer') {
      return getTeamReviewerGuidance({ role, teamRoles, isEntryPoint });
    }
  } catch {
    // Fall back to base guidance
  }

  return null;
}

/**
 * Get base role guidance
 */
function getBaseRoleGuidance(role: string, otherRoles: string[], isEntryPoint: boolean): string {
  const normalizedRole = role.toLowerCase();

  if (normalizedRole === 'builder') {
    return getBaseBuilderGuidance(isEntryPoint);
  }
  if (normalizedRole === 'reviewer') {
    return getBaseReviewerGuidance(otherRoles);
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
  convexUrl?: string; // Optional Convex URL for env var prefix generation
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
  const teamGuidance = getTeamRoleGuidance(ctx.role, ctx.teamRoles, isEntryPoint);
  if (teamGuidance) {
    sections.push(teamGuidance);
  } else {
    // Fall back to base guidance
    const otherRoles = ctx.teamRoles.filter((r) => r.toLowerCase() !== ctx.role.toLowerCase());
    sections.push(getBaseRoleGuidance(ctx.role, otherRoles, isEntryPoint));
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
  // Generate unique filename for handoff
  const messageFile = generateFilename('handoff', { type: 'md' });
  const cliEnvPrefix = getCliEnvPrefix(ctx.convexUrl);

  const handoffCmd = handoffCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    nextRole: '<target>',
    messageFile,
    cliEnvPrefix,
  });

  const waitCmd = waitForTaskCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    cliEnvPrefix,
  });

  return `### Commands

**Complete task and hand off:**

Handoff workflow (3 steps):
1. Create the handoff directory: \`mkdir -p ${HANDOFF_DIR}\`
2. Write your handoff message to a file: \`echo "<summary>" > ${messageFile}\`
3. Run the handoff command: \`${handoffCmd}\`

Full example:
\`\`\`bash
# Step 1: Create directory
mkdir -p ${HANDOFF_DIR}

# Step 2: Write handoff message (be specific and detailed)
cat > ${messageFile} << 'EOF'
## Summary
[Your summary here]

## Changes Made
- [List key changes]

## Testing
- [How to test]
EOF

# Step 3: Hand off to next role
${handoffCmd}
\`\`\`

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
  convexUrl?: string
): string {
  const normalizedRole = role.toLowerCase();
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  // Builder-specific reminders
  if (normalizedRole === 'builder') {
    const messageFile = generateFilename('handoff', { type: 'md' });
    const handoffCmd = handoffCommand({
      chatroomId,
      role: 'builder',
      nextRole: 'reviewer',
      messageFile,
      cliEnvPrefix,
    });

    switch (classification) {
      case 'question':
        return `You can respond directly to the user when done.
        
💡 You're working on:
${messageId ? `Message ID: ${messageId}` : `Task ID: ${taskId}`}`;
      case 'new_feature':
        return `When complete, write your summary to a file and hand off to reviewer for approval:

\`\`\`bash
# Create handoff message
mkdir -p ${HANDOFF_DIR}
cat > ${messageFile} << 'EOF'
## Summary
[Describe what you implemented]

## Changes Made
- [List key changes]

## Testing
- [How to test the feature]
EOF

# Hand off to reviewer
${handoffCmd}
\`\`\`

💡 You're working on:
${messageId ? `Message ID: ${messageId}` : `Task ID: ${taskId}`}`;
      case 'follow_up':
        return `Continue from where you left off. Same workflow rules as the original task apply.
        
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

export interface InitPromptInput {
  chatroomId: string;
  role: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  convexUrl?: string; // Optional Convex URL for env var prefix generation
}

/**
 * Generate a complete agent initialization prompt.
 * This is the full prompt shown when an agent first joins the chatroom.
 */
export function generateInitPrompt(input: InitPromptInput): string {
  const { chatroomId, role, teamName, teamRoles, teamEntryPoint, convexUrl } = input;
  const template = getRoleTemplate(role);
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  // Determine available handoff targets (other roles in the team + user)
  const otherRoles = teamRoles.filter((r) => r.toLowerCase() !== role.toLowerCase());
  const handoffTargets = [...new Set([...otherRoles, 'user'])];

  // Determine if this role is the entry point (receives user messages directly)
  const entryPoint = teamEntryPoint || teamRoles[0] || 'builder';
  const isEntryPoint = role.toLowerCase() === entryPoint.toLowerCase();

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
    getTeamRoleGuidance(role, teamRoles, isEntryPoint) ??
    getBaseRoleGuidance(role, otherRoles, isEntryPoint);

  const waitCmd = waitForTaskCommand({
    chatroomId,
    role,
    cliEnvPrefix,
  });

  const sections: string[] = [];
  sections.push(`# ${teamName} Team`);
  sections.push(`## Your Role: ${template.title.toUpperCase()}`);
  sections.push(template.description);
  if (isEntryPoint) {
    sections.push(getTaskStartedPrompt({ chatroomId, role }));
  }
  sections.push(guidance);
  sections.push(getCommandsSection(roleCtx));
  sections.push(`### Next\n\nRun:\n\n\`\`\`bash\n${waitCmd}\n\`\`\``);

  return sections
    .filter((s) => s.trim())
    .join('\n\n')
    .trim();
}
