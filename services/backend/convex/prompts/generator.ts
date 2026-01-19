/**
 * Role Prompt Generator
 *
 * Generates role-specific prompts that are returned with each message.
 * These prompts are designed to be refreshed with every wait-for-task
 * to combat context rot in long conversations.
 */

import { getRoleTemplate } from './templates';

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

function getReviewerWorkflow(_ctx: RolePromptContext): string {
  return `### Workflow

**Important: Do NOT run task-started** - the task is already classified by the builder.

1. Receive handoff from builder with work summary
2. Review the code changes:
   - Check uncommitted: \`git status\`, \`git diff\`
   - Check commits: \`git log --oneline -5\`, \`git show HEAD\`
3. Either approve or request changes

**Review Checklist:**
- [ ] Code correctness and functionality
- [ ] Error handling and edge cases  
- [ ] Code style and best practices
- [ ] Requirements met`;
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
chatroom handoff ${ctx.chatroomId} \\
  --role=${ctx.role} \\
  --message="<summary>" \\
  --next-role=<target>
\`\`\`

**Always run after any command:**
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
        return `When complete, hand off to reviewer for approval:
\`\`\`
chatroom handoff ${chatroomId} --role=builder --message="<summary>" --next-role=reviewer
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
