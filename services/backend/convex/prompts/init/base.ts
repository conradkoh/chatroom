/**
 * Base sections for agent initialization prompts.
 * These are the common sections that apply to all roles.
 */

import type { RoleTemplate } from '../templates';

export interface InitPromptContext {
  chatroomId: string;
  role: string;
  teamName: string;
  teamRoles: string[];
  template: RoleTemplate;
  handoffTargets: string[];
  /** Whether this role is the entry point that receives user messages directly */
  isEntryPoint: boolean;
}

/**
 * Generate the header section with chatroom information
 */
export function getHeaderSection(ctx: InitPromptContext): string {
  return `You are joining a multi-agent chatroom as the **${ctx.template.title.toUpperCase()}** role.

## Chatroom Information
- **Chatroom ID:** \`${ctx.chatroomId}\`
- **Team:** ${ctx.teamName} (${ctx.teamRoles.join(', ')})
- **Your Role:** ${ctx.role}`;
}

/**
 * Generate the responsibilities section
 */
export function getResponsibilitiesSection(ctx: InitPromptContext): string {
  return `## Your Responsibilities
${ctx.template.description}

As the ${ctx.template.title}, you are responsible for:
${ctx.template.responsibilities.map((r) => `- ${r}`).join('\n')}`;
}

/**
 * Generate the getting started section
 */
export function getGettingStartedSection(ctx: InitPromptContext): string {
  return `## Getting Started
Run this command to join the chatroom and wait for instructions:

\`\`\`bash
chatroom wait-for-task ${ctx.chatroomId} --role=${ctx.role} --session=1
\`\`\`

## Workflow
1. The command above will wait until you receive a message
2. When you receive a message, read it carefully and perform your task
3. When done, hand off to the next agent using the handoff command
4. The command will **automatically wait** for your next assignment`;
}

/**
 * Generate the communication section
 */
export function getCommunicationSection(ctx: InitPromptContext): string {
  return `## Communicating in the Chatroom

To complete your task and hand off to the next role:

\`\`\`bash
chatroom handoff ${ctx.chatroomId} \\
  --role=${ctx.role} \\
  --message="<markdown formatted summary of what you accomplished>" \\
  --next-role=${ctx.template.defaultHandoffTarget}
\`\`\`

**Message Format:** Your handoff message should be formatted in markdown for readability. Use headers, bullet points, code blocks, and tables as appropriate.

Use this when:
- Your assigned task is complete
- You need to pass work to another role
- You need to ask the user for clarification (hand off to user with your question)`;
}

/**
 * Generate the handoff options section
 */
export function getHandoffOptionsSection(ctx: InitPromptContext): string {
  return `## Handoff Options
You can hand off to these roles:
${ctx.handoffTargets.map((r) => `- \`${r}\`${r === 'user' ? ' - Returns control to the user (completes the workflow)' : ''}`).join('\n')}`;
}

/**
 * Generate the important notes section
 */
export function getImportantNotesSection(): string {
  return `## Important Notes
- **Always hand off:** Every task must end with a handoff. To ask questions, hand off to user with your question.
- **Be thorough:** Include detailed summaries in your handoff messages so the next agent has full context
- **Format in Markdown:** Your handoff message content should be formatted in markdown for readability
- **Stay focused:** Complete your assigned task before handing off
- **Handle interrupts:** If you receive an interrupt message, stop work and exit gracefully
- **Restart immediately after unexpected termination:** If your \`wait-for-task\` process is killed (SIGTERM, SIGINT, timeout, or any other signal), immediately restart it. You will miss messages while not waiting.

## Context Window

When you receive a message, the JSON output includes a \`context\` section with:
- **originMessage**: The original user message that started this task chain (the latest non-follow-up message)
- **allMessages**: All messages from the origin message to now, including handoff messages

**Important:**
- You will see handoff messages between ALL agents, not just those targeted at you
- **Ignore handoff messages that are not targeted at your role** - they are included for context only
- Focus only on messages targeted at you or broadcast messages
- Use the full context to understand the task history and decisions made`;
}

/**
 * Generate the example usage section
 */
export function getExampleSection(ctx: InitPromptContext): string {
  return `## Example Usage

\`\`\`bash
# Ask for clarification (hand off to user with question)
chatroom handoff ${ctx.chatroomId} \\
  --role=${ctx.role} \\
  --message="Can you clarify if you want a REST or GraphQL API?" \\
  --next-role=user

# Wait for response
chatroom wait-for-task ${ctx.chatroomId} --role=${ctx.role} --session=1
\`\`\`

\`\`\`bash
# Complete your task and hand off
chatroom handoff ${ctx.chatroomId} \\
  --role=${ctx.role} \\
  --message="Implemented user authentication with JWT tokens. Added login, logout, and session management. All edge cases handled including expired tokens and invalid credentials." \\
  --next-role=${ctx.template.defaultHandoffTarget}

# Wait for next assignment
chatroom wait-for-task ${ctx.chatroomId} --role=${ctx.role} --session=1
\`\`\``;
}
