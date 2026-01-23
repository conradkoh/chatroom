/**
 * Task Delivery Prompt Module
 *
 * This module handles generating the complete prompt shown to agents
 * when they receive a task via wait-for-task.
 */

import { HANDOFF_DIR } from '../config';
import { buildJsonOutput } from './sections';
import type { TaskDeliveryContext, TaskDeliveryPromptResponse } from './types';

export * from './types';
export * from './formatters';
export { buildJsonOutput } from './sections';

/**
 * Format timestamp for display
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Build the role guidance section
 */
function buildRoleGuidance(ctx: TaskDeliveryContext): string {
  return ctx.rolePrompt.prompt;
}

/**
 * Build the command reference section
 */
function buildCommandReference(ctx: TaskDeliveryContext): string {
  const lines: string[] = [];

  lines.push(`**Handoff (complete task):**`);
  lines.push(`\`\`\`bash`);
  lines.push(
    `chatroom handoff ${ctx.chatroomId} --role=${ctx.role} --message-file="${HANDOFF_DIR}/message.md" --next-role=<target>`
  );
  lines.push(`\`\`\``);
  lines.push(``);
  lines.push(`**Backlog:**`);
  lines.push(`\`\`\`bash`);
  lines.push(`chatroom backlog list ${ctx.chatroomId} --role=${ctx.role} --status=active`);
  lines.push(`\`\`\``);
  lines.push(``);
  lines.push(`**Wait for tasks:**`);
  lines.push(`\`\`\`bash`);
  lines.push(`chatroom wait-for-task ${ctx.chatroomId} --role=${ctx.role}`);
  lines.push(`\`\`\``);

  return lines.join('\n');
}

/**
 * Build the pinned context section (user directive + task status)
 */
function buildPinnedContext(ctx: TaskDeliveryContext): string {
  const lines: string[] = [];

  // Primary User Directive
  const originContent = ctx.contextWindow.originMessage?.content || ctx.task.content;
  lines.push(`### Primary User Directive`);
  lines.push(`<user-message>`);
  lines.push(originContent);
  lines.push(`</user-message>`);
  lines.push(``);

  // Inferred Task status
  lines.push(`### Inferred Task (inferred from user directive)`);
  if (ctx.rolePrompt.currentClassification) {
    lines.push(`Classification: ${ctx.rolePrompt.currentClassification}`);
  } else {
    lines.push(
      `Not created yet. Run \`chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=<type>\` to specify task.`
    );
  }

  return lines.join('\n');
}

/**
 * Build the new message section
 */
function buildNewMessage(ctx: TaskDeliveryContext): string {
  const senderRole = ctx.message?.senderRole || ctx.task.createdBy;
  const targetRole = ctx.message?.targetRole || ctx.role;
  const content = ctx.message?.content || ctx.task.content;

  const lines: string[] = [];
  lines.push(`<message>`);
  lines.push(`From: ${senderRole}`);
  lines.push(`To: ${targetRole}`);
  lines.push(``);
  lines.push(content);
  lines.push(`</message>`);

  return lines.join('\n');
}

/**
 * Build the next steps section
 */
function buildNextSteps(ctx: TaskDeliveryContext): string {
  const senderRole = ctx.message?.senderRole || ctx.task.createdBy;
  const needsClassification =
    ctx.rolePrompt.currentClassification === null && senderRole.toLowerCase() === 'user';

  const lines: string[] = [];

  if (needsClassification) {
    lines.push(
      `Please infer the task from the message addressed to you and acknowledge it using the command:`
    );
    lines.push(``);

    // Include message ID if available
    if (ctx.message) {
      lines.push(
        `> chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=<question|new_feature|follow_up> --message-id=${ctx.message._id}`
      );
    } else {
      lines.push(
        `> chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=<question|new_feature|follow_up>`
      );
    }
    lines.push(``);
    lines.push(
      `After that, follow the user's instructions. Remember that the user is in the chatroom, and may not be able to see what you are saying if you don't send it to him.`
    );
    lines.push(``);
  }

  const defaultTarget = ctx.rolePrompt.availableHandoffRoles[0] || 'user';
  const handoffCommand = `chatroom handoff ${ctx.chatroomId} --role=${ctx.role} --message-file="${HANDOFF_DIR}/message.md" --next-role=${defaultTarget}`;
  const waitCommand = `chatroom wait-for-task ${ctx.chatroomId} --role=${ctx.role}`;

  lines.push(`## Next Steps`);
  lines.push(`1. Hand off to the next individual to start work by running \`${handoffCommand}\``);
  lines.push(
    `2. Run \`${waitCommand}\` to wait for the next message. Use \`wait-for-task\` to stay available: The chatroom is where users and other agents can reach you with messages and responses`
  );

  return lines.join('\n');
}

/**
 * Builds the complete task delivery prompt from the given context.
 *
 * @param ctx The task delivery context containing all data
 * @returns TaskDeliveryPromptResponse with humanReadable and json
 */
export function buildTaskDeliveryPrompt(ctx: TaskDeliveryContext): TaskDeliveryPromptResponse {
  const lines: string[] = [];

  // HTML comment block with metadata
  lines.push(`<!--`);
  lines.push(`Current Time: ${formatTimestamp(ctx.currentTimestamp)}`);
  lines.push(`## Role`);
  lines.push(buildRoleGuidance(ctx));
  lines.push(``);
  lines.push(`## Command reference`);
  lines.push(buildCommandReference(ctx));
  lines.push(``);
  lines.push(`## 📍 Pinned`);
  lines.push(buildPinnedContext(ctx));
  lines.push(`-->`);
  lines.push(``);

  // Task Content
  lines.push(`# Task Content`);
  lines.push(``);
  lines.push(`## New Message (addressed to you for processing)`);
  lines.push(buildNewMessage(ctx));
  lines.push(``);
  lines.push(buildNextSteps(ctx));

  const humanReadable = lines.join('\n');

  // Build JSON output
  const json = buildJsonOutput(ctx);

  return {
    humanReadable,
    json,
  };
}
