/**
 * Role Prompt Generator
 *
 * Generates role-specific prompts that are returned with each message.
 * These prompts are designed to be refreshed with every wait-for-task
 * to combat context rot in long conversations.
 */

import { HANDOFF_DIR, getHandoffFileSnippet } from './config';
import {
  type InitPromptContext,
  getHeaderSection,
  getResponsibilitiesSection,
  getGettingStartedSection,
  getCommunicationSection,
  getHandoffOptionsSection,
  getImportantNotesSection,
  getExampleSection,
  getRoleSpecificGuidance,
  getWaitForTaskSection,
  getTaskStartedSection,
} from './init';
import { getRoleTemplate } from './templates';
// Guidelines and policies are exported for external use
// They can be included in review prompts as needed
export { getReviewGuidelines } from './guidelines';
export { getSecurityPolicy } from './policies/security';
export { getDesignPolicy } from './policies/design';
export { getPerformancePolicy } from './policies/performance';

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

  // Workflow section (role-specific)
  if (normalizedRole === 'builder') {
    sections.push(getBuilderWorkflow(ctx, isEntryPoint));
  } else if (normalizedRole === 'reviewer') {
    sections.push(getReviewerWorkflow(ctx));
  } else {
    sections.push(getGenericWorkflow(ctx, template));
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

function getBuilderWorkflow(ctx: RolePromptContext, isEntryPoint: boolean): string {
  let workflow = `### Workflow

1. Receive task (from user or reviewer handoff)
2. Implement the requested changes
3. Commit your work with clear messages
4. Hand off to reviewer with a summary`;

  if (isEntryPoint && !ctx.currentClassification) {
    workflow += `

**IMPORTANT: Classify the task first!**
Since you're the entry point, run task-started to classify this message:
\`\`\`
chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=<question|new_feature|follow_up>
\`\`\``;
  }

  return workflow;
}

function getReviewerWorkflow(ctx: RolePromptContext): string {
  const sections: string[] = [];

  // Core workflow
  sections.push(`### Workflow

**Important: Do NOT run task-started** - the task is already classified by the builder.

**Phase 1: Understand the Request**
First, read the ORIGINAL user request below to understand what should have been built.

**Phase 2: Run Verification Commands**
\`\`\`bash
pnpm typecheck    # Check for TypeScript errors
pnpm lint:fix     # Check for linting issues
git status        # View uncommitted changes
git diff          # View detailed changes
git log --oneline -5  # View recent commits
\`\`\`

**Phase 3: Review Against Checklist**
- [ ] TypeScript: No errors, no \`any\` types, proper typing
- [ ] Code quality: No hacks/shortcuts, proper patterns
- [ ] Requirements: ALL original requirements addressed
- [ ] Guidelines: Follows codebase conventions (check AGENTS.md, etc.)
- [ ] Design: Uses design system (semantic colors, existing components)
- [ ] Security: No obvious vulnerabilities

**Phase 4: Decision**
- **Changes needed** → Provide specific feedback, hand to builder
- **Approved** → Confirm requirements met, hand to user`);

  // Inject user context if available
  if (ctx.userContext) {
    sections.push(getUserContextSection(ctx.userContext));
  }

  // Multi-phase review option
  sections.push(`### Multi-Phase Review

For complex reviews, you can break the review into phases:

1. **Phase 1**: TypeScript and linting verification
2. **Phase 2**: Code quality and patterns review
3. **Phase 3**: Requirements and design compliance

To continue to the next phase, hand off to yourself:
\`\`\`bash
# Write message to file with unique ID first
${getHandoffFileSnippet('message')}
echo "Phase 1 complete: <findings>. Continuing to Phase 2." > "$MSG_FILE"

chatroom handoff ${ctx.chatroomId} --role=reviewer --message-file="$MSG_FILE" --next-role=reviewer
\`\`\``);

  return sections.join('\n\n');
}

/**
 * Generate the user context section for reviewers
 */
function getUserContextSection(userContext: NonNullable<RolePromptContext['userContext']>): string {
  const parts: string[] = ['### Original User Request\n'];
  parts.push('**IMPORTANT: Verify the implementation matches this original request:**\n');
  parts.push(`> ${userContext.originalRequest.split('\n').join('\n> ')}`);

  if (userContext.featureTitle) {
    parts.push(`\n**Feature Title:** ${userContext.featureTitle}`);
  }

  if (userContext.featureDescription) {
    parts.push(`\n**Description:**\n${userContext.featureDescription}`);
  }

  if (userContext.techSpecs) {
    parts.push(`\n**Technical Specifications:**\n${userContext.techSpecs}`);
  }

  return parts.join('\n');
}

function getGenericWorkflow(
  _ctx: RolePromptContext,
  template: ReturnType<typeof getRoleTemplate>
): string {
  return `### Workflow

1. Receive and understand the task
2. Complete your responsibilities:
${template.responsibilities.map((r) => `   - ${r}`).join('\n')}
3. Hand off to the next role when done`;
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
  return `### Commands

**Complete task and hand off:**
\`\`\`
# Write message to file first:
# mkdir -p ${HANDOFF_DIR} && echo "<summary>" > ${HANDOFF_DIR}/message.md
chatroom handoff ${ctx.chatroomId} \\
  --role=${ctx.role} \\
  --message-file="${HANDOFF_DIR}/message.md" \\
  --next-role=<target>
\`\`\`

**Always run after handoff:**
\`\`\`
chatroom wait-for-task ${ctx.chatroomId} --role=${ctx.role}
\`\`\`

**⚠️ If wait-for-task is killed unexpectedly (SIGTERM, timeout, etc.), immediately restart it!**`;
}

/**
 * Generate a focused reminder for task-started based on role + classification.
 * Returns a short, specific prompt reminding the agent of the expected action.
 */
export function generateTaskStartedReminder(
  role: string,
  classification: 'question' | 'new_feature' | 'follow_up',
  chatroomId: string
): string {
  const normalizedRole = role.toLowerCase();

  // Builder-specific reminders
  if (normalizedRole === 'builder') {
    switch (classification) {
      case 'question':
        return `You can respond directly to the user when done.`;
      case 'new_feature':
        return `When complete, write your summary to a file and hand off to reviewer for approval:
\`\`\`
mkdir -p ${HANDOFF_DIR} && MSG_FILE="${HANDOFF_DIR}/message-$(date +%s%N).md"
echo "<summary>" > "$MSG_FILE"
chatroom handoff ${chatroomId} --role=builder --message-file="$MSG_FILE" --next-role=reviewer
\`\`\``;
      case 'follow_up':
        return `Continue from where you left off. Same workflow rules as the original task apply.`;
    }
  }

  // Reviewer should not call task-started (they receive pre-classified tasks)
  // But provide a fallback just in case
  if (normalizedRole === 'reviewer') {
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
}

/**
 * Generate a complete agent initialization prompt.
 * This is the full prompt shown when an agent first joins the chatroom.
 */
export function generateInitPrompt(input: InitPromptInput): string {
  const { chatroomId, role, teamName, teamRoles, teamEntryPoint } = input;
  const template = getRoleTemplate(role);

  // Determine available handoff targets (other roles in the team + user)
  const otherRoles = teamRoles.filter((r) => r.toLowerCase() !== role.toLowerCase());
  const handoffTargets = [...new Set([...otherRoles, 'user'])];

  // Determine if this role is the entry point (receives user messages directly)
  const entryPoint = teamEntryPoint || teamRoles[0] || 'builder';
  const isEntryPoint = role.toLowerCase() === entryPoint.toLowerCase();

  // Build the init prompt context
  const ctx: InitPromptContext = {
    chatroomId,
    role,
    teamName,
    teamRoles,
    template,
    handoffTargets,
    isEntryPoint,
  };

  // Get role-specific guidance
  const roleSpecificGuidance = getRoleSpecificGuidance(role, otherRoles, isEntryPoint);

  // Compose the prompt from sections
  // Only include task-started section for entry-point roles
  const sections = [
    getHeaderSection(ctx),
    getResponsibilitiesSection(ctx),
    getGettingStartedSection(ctx),
    isEntryPoint ? getTaskStartedSection(ctx) : '',
    getCommunicationSection(ctx),
    getHandoffOptionsSection(ctx),
    roleSpecificGuidance,
    getImportantNotesSection(),
    getWaitForTaskSection(ctx),
    getExampleSection(ctx),
  ];

  // Filter out empty sections and join with double newlines
  return sections
    .filter((s) => s.trim())
    .join('\n\n')
    .trim();
}
