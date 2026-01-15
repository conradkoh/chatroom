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
chatroom wait-for-message ${ctx.chatroomId} --role=${ctx.role}
\`\`\`

## Workflow
1. The command above will wait until you receive a message
2. When you receive a message, read it carefully and perform your task
3. When done, hand off to the next agent using the task-complete command
4. The command will **automatically wait** for your next assignment`;
}

/**
 * Generate the communication section
 */
export function getCommunicationSection(ctx: InitPromptContext): string {
  return `## Communicating in the Chatroom

You have two ways to communicate:

### 1. Sending Messages
To send a message to the chatroom (to ask questions, provide updates, or communicate with other agents):

\`\`\`bash
chatroom send ${ctx.chatroomId} --message="<your message>" --role=${ctx.role}
\`\`\`

Use this when you need to:
- Ask the user for clarification
- Request information from other agents
- Provide status updates
- Communicate something that doesn't complete your task

### 2. Completing Tasks (Handoff)
To complete your task and hand off to the next role:

\`\`\`bash
chatroom task-complete ${ctx.chatroomId} \\
  --role=${ctx.role} \\
  --message="<detailed summary of what you accomplished>" \\
  --next-role=${ctx.template.defaultHandoffTarget}
\`\`\`

Use this when:
- Your assigned task is complete
- You need to pass work to another role
- You're ready to exit the workflow`;
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
- **Communication:** Use \`chatroom send\` to ask questions or provide updates. Use \`task-complete\` only when your task is done.
- **Be thorough:** Include detailed summaries in your handoff messages so the next agent has full context
- **Stay focused:** Complete your assigned task before handing off
- **Handle interrupts:** If you receive an interrupt message, stop work and exit gracefully

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
# Ask for clarification before starting
chatroom send ${ctx.chatroomId} --message="Can you clarify if you want a REST or GraphQL API?" --role=${ctx.role}

# Wait for response
chatroom wait-for-message ${ctx.chatroomId} --role=${ctx.role}
\`\`\`

\`\`\`bash
# Complete your task and hand off
chatroom task-complete ${ctx.chatroomId} \\
  --role=${ctx.role} \\
  --message="Implemented user authentication with JWT tokens. Added login, logout, and session management. All edge cases handled including expired tokens and invalid credentials." \\
  --next-role=${ctx.template.defaultHandoffTarget}

# Wait for next assignment
chatroom wait-for-message ${ctx.chatroomId} --role=${ctx.role}
\`\`\``;
}
