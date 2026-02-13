/**
 * Full CLI output generator for wait-for-task task delivery.
 *
 * Generates the complete text output that the CLI prints when a task is received.
 * This centralizes all structural template generation in the backend,
 * making the CLI a thin client that just prints the result.
 *
 * The output includes:
 * - Task Information section (task ID, message ID)
 * - Next Steps section (classification or handoff instructions)
 * - Context wrapper (available actions & role instructions)
 * - Pinned section (context or user message, attached backlog, classification)
 * - Process section (4-step workflow)
 * - Reminder footer
 */

import { waitForTaskCommand } from './command.js';
import { getWaitForTaskReminder } from './reminder.js';
import { taskStartedCommand } from '../task-started/command.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FullCliOutputParams {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;

  /** The task being delivered */
  task: {
    _id: string;
    content: string;
  };

  /** The message associated with the task (may be null) */
  message: {
    _id: string;
    senderRole: string;
    content: string;
  } | null;

  /** Pre-generated available actions + role prompt + reminder (the humanReadable field) */
  humanReadable: string;

  /** Explicit context (new system) */
  currentContext: {
    content: string;
    messagesSinceContext: number;
    elapsedHours: number;
  } | null;

  /** Origin message for fallback when no explicit context */
  originMessage: {
    senderRole: string;
    content: string;
    classification?: string | null;
    attachedTasks?: {
      status: string;
      content: string;
    }[];
  } | null;

  /** Number of follow-up messages since origin */
  followUpCountSinceOrigin: number;

  /** Timestamp of origin message creation */
  originMessageCreatedAt: number | null;
}

// ─── Generator ────────────────────────────────────────────────────────────────

/**
 * Generate the complete CLI output for task delivery.
 *
 * This is the full text printed by the CLI after "Task received!".
 * The CLI only needs to prepend a timestamp line and print this string.
 */
export function generateFullCliOutput(params: FullCliOutputParams): string {
  const {
    chatroomId,
    role,
    cliEnvPrefix,
    task,
    message,
    humanReadable,
    currentContext,
    originMessage,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
  } = params;

  const lines: string[] = [];
  const SEP_EQUAL = '='.repeat(60);

  // ── Task Information ──────────────────────────────────────────────────────

  lines.push(SEP_EQUAL);
  lines.push('🆔 TASK INFORMATION');
  lines.push(SEP_EQUAL);
  lines.push(`Task ID: ${task._id}`);
  if (message) {
    lines.push(`Message ID: ${message._id}`);
  }

  // ── Next Steps ────────────────────────────────────────────────────────────

  lines.push('');
  lines.push('📋 NEXT STEPS');
  lines.push(SEP_EQUAL);

  const isUserMessage = message && message.senderRole.toLowerCase() === 'user';

  if (isUserMessage) {
    lines.push('To acknowledge and classify this message, run:');
    lines.push('');

    // Base command with <type> placeholder
    const baseCmd = taskStartedCommand({
      chatroomId,
      role,
      taskId: task._id,
      classification: 'question',
      cliEnvPrefix,
    }).replace(
      '--origin-message-classification=question',
      '--origin-message-classification=<type>'
    );
    lines.push(baseCmd);

    // Classification requirements
    lines.push('');
    lines.push('📝 Classification Requirements:');
    lines.push('   • question: No additional fields required');
    lines.push('   • follow_up: No additional fields required');
    lines.push('   • new_feature: REQUIRES --title, --description, --tech-specs');

    // new_feature example
    lines.push('');
    lines.push('💡 Example for new_feature:');
    lines.push(
      taskStartedCommand({
        chatroomId,
        role,
        taskId: task._id,
        classification: 'new_feature',
        title: '<title>',
        description: '<description>',
        techSpecs: '<tech-specs>',
        cliEnvPrefix,
      })
    );

    lines.push('');
    lines.push('Classification types: question, new_feature, follow_up');
  } else if (message) {
    lines.push(`Task handed off from ${message.senderRole}.`);
    lines.push(
      'The original user message was already classified - you can start work immediately.'
    );
  } else {
    lines.push(`No message found. Task ID: ${task._id}`);
  }

  lines.push(SEP_EQUAL);

  // ── Context wrapper (available actions & role instructions) ────────────────

  lines.push('');
  lines.push('<!-- CONTEXT: Available Actions & Role Instructions');
  lines.push(humanReadable);
  lines.push('-->');

  // ── Pinned section ────────────────────────────────────────────────────────

  lines.push('');
  lines.push(SEP_EQUAL);
  lines.push('📍 PINNED - Work on this immediately');
  lines.push(SEP_EQUAL);

  // Display explicit context if available (new system)
  if (currentContext) {
    lines.push('');
    lines.push('## Context');
    lines.push('<context>');
    lines.push(currentContext.content);

    // Staleness warning: many messages since context was set
    if (currentContext.messagesSinceContext >= 10) {
      lines.push('');
      lines.push(
        `⚠️  WARNING: ${currentContext.messagesSinceContext} messages since this context was set.`
      );
      lines.push('   Consider updating the context with a summary of recent developments.');
      lines.push('   Create a new context with:');
      lines.push(
        `   ${cliEnvPrefix}chatroom context new --chatroom-id=${chatroomId} --role=${role} --content="<summary>"`
      );
    }

    // Staleness warning: old context
    if (currentContext.elapsedHours >= 24) {
      const ageDays = Math.floor(currentContext.elapsedHours / 24);
      lines.push('');
      lines.push(`⚠️  WARNING: This context is ${ageDays} day(s) old.`);
      lines.push('   Consider creating a new context with updated summary.');
      lines.push(
        `   ${cliEnvPrefix}chatroom context new --chatroom-id=${chatroomId} --role=${role} --content="<summary>"`
      );
    }

    lines.push('</context>');
  }
  // Fallback to origin message if no context (legacy behavior)
  else if (originMessage && originMessage.senderRole.toLowerCase() === 'user') {
    lines.push('');
    lines.push('## User Message');
    lines.push('<user-message>');
    lines.push(originMessage.content);

    // Staleness warning: many follow-ups
    if (followUpCountSinceOrigin >= 5) {
      lines.push('');
      lines.push(
        `⚠️  WARNING: ${followUpCountSinceOrigin} follow-up messages since this pinned message.`
      );
      lines.push('   The user may have moved on to a different topic.');
      lines.push('   Consider creating a context with:');
      lines.push(
        `   ${cliEnvPrefix}chatroom context new --chatroom-id=${chatroomId} --role=${role} --content="<summary>"`
      );
    }

    // Staleness warning: old pinned message
    if (originMessageCreatedAt) {
      const ageMs = Date.now() - originMessageCreatedAt;
      const ageHours = ageMs / (1000 * 60 * 60);
      if (ageHours >= 24) {
        const ageDays = Math.floor(ageHours / 24);
        lines.push('');
        lines.push(`⚠️  WARNING: This pinned message is ${ageDays} day(s) old.`);
        lines.push('   Consider creating a context with:');
        lines.push(
          `   ${cliEnvPrefix}chatroom context new --chatroom-id=${chatroomId} --role=${role} --content="<summary>"`
        );
      }
    }

    lines.push('</user-message>');
  }

  // Task content
  lines.push('');
  lines.push('## Task');
  lines.push(task.content);

  // Attached backlog tasks from origin message
  if (originMessage?.attachedTasks && originMessage.attachedTasks.length > 0) {
    lines.push('');
    lines.push(`## Attached Backlog (${originMessage.attachedTasks.length})`);
    for (const attachedTask of originMessage.attachedTasks) {
      lines.push(`- [${attachedTask.status.toUpperCase()}] ${attachedTask.content}`);
    }
  }

  // Classification status
  const existingClassification = originMessage?.classification;
  if (existingClassification) {
    lines.push('');
    lines.push(`Classification: ${existingClassification.toUpperCase()}`);
  }

  // ── Process section ───────────────────────────────────────────────────────

  lines.push('');
  lines.push(SEP_EQUAL);
  lines.push('📋 PROCESS');
  lines.push(SEP_EQUAL);

  lines.push('');
  lines.push('1. Mark task as started:');
  if (isUserMessage) {
    lines.push(
      `   ${taskStartedCommand({ chatroomId, role, taskId: task._id, classification: 'follow_up', cliEnvPrefix })}`
    );
  } else {
    lines.push(
      `   ${cliEnvPrefix}chatroom task-started --chatroom-id=${chatroomId} --role=${role} --task-id=${task._id} --no-classify`
    );
  }
  lines.push('');
  lines.push('2. Do the work');
  lines.push('');
  lines.push('3. Hand off when complete:');
  lines.push(
    `   ${cliEnvPrefix}chatroom handoff --chatroom-id=${chatroomId} --role=${role} --next-role=<target>`
  );
  lines.push('');
  lines.push('4. Resume listening:');
  lines.push(`   ${waitForTaskCommand({ chatroomId, role, cliEnvPrefix })}`);

  // ── Reminder footer ───────────────────────────────────────────────────────

  lines.push('');
  lines.push(SEP_EQUAL);
  lines.push(getWaitForTaskReminder());
  lines.push(SEP_EQUAL);

  return lines.join('\n');
}
