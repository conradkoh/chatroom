/**
 * Full CLI output generator for get-next-task task delivery.
 *
 * Generates the complete text output that the CLI prints when a task is received.
 * This centralizes all structural template generation in the backend,
 * making the CLI a thin client that just prints the result.
 *
 * The output includes:
 * - Task section (IDs, context, task content, attached backlog, classification)
 * - Process section (step-by-step workflow)
 * - Next Steps section (directive classification or handoff instructions)
 * - Reminder footer
 */

import { getNextTaskReminder, getCompactionRecoveryOneLiner } from './reminder';
import { contextNewCommand } from '../context/new';
import { taskStartedCommand } from '../task-started/command';

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
    attachedBacklogItems?: {
      status: string;
      content: string;
    }[];
  } | null;

  /** Number of follow-up messages since origin */
  followUpCountSinceOrigin: number;

  /** Timestamp of origin message creation */
  originMessageCreatedAt: number | null;

  /** Whether this role is the team entry point (planner/coordinator). Only entry points can create contexts. */
  isEntryPoint: boolean;

  /** Available handoff targets for this role (e.g. ['builder', 'reviewer', 'user']) */
  availableHandoffTargets: string[];
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
    currentContext,
    originMessage,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
    isEntryPoint,
    availableHandoffTargets,
  } = params;

  const lines: string[] = [];
  const SEP_EQUAL = '='.repeat(60);

  const isUserMessage = message && message.senderRole.toLowerCase() === 'user';

  // ── Task section (IDs + context + content + backlog) ──────────────────────

  lines.push('<task>');
  lines.push(SEP_EQUAL);
  lines.push('📋 TASK');
  lines.push(SEP_EQUAL);
  lines.push(`Task ID: ${task._id}`);
  if (message) {
    lines.push(`Origin Message ID: ${message._id}`);
    lines.push(`From: ${message.senderRole}`);
  }

  // Display explicit context if available (new system)
  if (currentContext) {
    lines.push('');
    lines.push('## Context');
    lines.push(
      `(read if needed) → \`${cliEnvPrefix}chatroom context read --chatroom-id="${chatroomId}" --role="${role}"\``
    );

    // Staleness warning: many messages since context was set
    if (currentContext.messagesSinceContext >= 10) {
      lines.push('');
      lines.push(`⚠️ Stale context: ${currentContext.messagesSinceContext} messages since set.`);
      if (isEntryPoint) {
        lines.push(
          `   Update → \`${cliEnvPrefix}chatroom context new --chatroom-id="${chatroomId}" --role="${role}" --content="<summary>"\``
        );
      } else {
        lines.push('   Entry point role will update when needed.');
      }
    }

    // Staleness warning: old context
    if (currentContext.elapsedHours >= 24) {
      const ageDays = Math.floor(currentContext.elapsedHours / 24);
      lines.push('');
      lines.push(`⚠️ Context is ${ageDays}d old.`);
      if (isEntryPoint) {
        lines.push(
          `   Update → \`${cliEnvPrefix}chatroom context new --chatroom-id="${chatroomId}" --role="${role}" --content="<summary>"\``
        );
      } else {
        lines.push('   Entry point role will update when needed.');
      }
    }
  }
  // Fallback to origin message if no context (legacy behavior)
  else if (originMessage && originMessage.senderRole.toLowerCase() === 'user') {
    lines.push('');
    lines.push('## Context');
    lines.push(
      `(read if needed) → \`${cliEnvPrefix}chatroom context read --chatroom-id="${chatroomId}" --role="${role}"\``
    );

    // Staleness warning: many follow-ups
    if (followUpCountSinceOrigin >= 5) {
      lines.push('');
      lines.push(`⚠️ Stale: ${followUpCountSinceOrigin} follow-ups since pinned message.`);
      if (isEntryPoint) {
        lines.push(
          `   Update → \`${cliEnvPrefix}chatroom context new --chatroom-id="${chatroomId}" --role="${role}" --content="<summary>"\``
        );
      } else {
        lines.push('   Entry point role will update when needed.');
      }
    }

    // Staleness warning: old pinned message
    if (originMessageCreatedAt) {
      const ageMs = Date.now() - originMessageCreatedAt;
      const ageHours = ageMs / (1000 * 60 * 60);
      if (ageHours >= 24) {
        const ageDays = Math.floor(ageHours / 24);
        lines.push('');
        lines.push(`⚠️ Pinned message is ${ageDays}d old.`);
        if (isEntryPoint) {
          lines.push(
            `   Update → \`${cliEnvPrefix}chatroom context new --chatroom-id="${chatroomId}" --role="${role}" --content="<summary>"\``
          );
        } else {
          lines.push('   Entry point role will update when needed.');
        }
      }
    }
  }

  // Task content — hidden; agent must call task read to get content (marks in_progress)
  lines.push('');
  lines.push('## Task');
  lines.push(`To read this task and mark it as in_progress, run:`);
  lines.push('```');
  lines.push(
    `${cliEnvPrefix}chatroom task read --chatroom-id="${chatroomId}" --role="${role}" --task-id="${task._id}"`
  );
  lines.push('```');

  // Attached items from origin message (legacy chatroom_tasks + backlog items)
  const allAttached = [
    ...(originMessage?.attachedTasks ?? []),
    ...(originMessage?.attachedBacklogItems ?? []),
  ];
  if (allAttached.length > 0) {
    lines.push('');
    lines.push(`## Attached Backlog (${allAttached.length})`);
    for (const attached of allAttached) {
      lines.push(`- [${attached.status.toUpperCase()}] ${attached.content}`);
    }
  }

  // Classification status
  const existingClassification = originMessage?.classification;
  if (existingClassification) {
    lines.push('');
    lines.push(`Classification: ${existingClassification.toUpperCase()}`);
  }

  lines.push('</task>');

  // ── Next Steps ──────────────────────────────────────────────────────────

  lines.push('');
  lines.push('<next-steps>');

  if (isUserMessage) {
    // User message case: read task first, then classify
    lines.push('⚠️  REQUIRED FIRST STEP: Read the task to mark it as in_progress.');
    lines.push('');

    // Step 1: Read task
    lines.push(
      `1. Read task → \`${cliEnvPrefix}chatroom task read --chatroom-id="${chatroomId}" --role="${role}" --task-id="${task._id}"\``
    );

    // Step 2: Classify
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
    lines.push(`2. Classify → \`${baseCmd}\``);

    // new_feature example
    lines.push('');
    lines.push('   new_feature example:');
    lines.push(
      `   ${taskStartedCommand({
        chatroomId,
        role,
        taskId: task._id,
        classification: 'new_feature',
        title: '<title>',
        description: '<description>',
        techSpecs: '<tech-specs>',
        cliEnvPrefix,
      })}`
    );

    if (role === 'planner') {
      // Planner role receiving a new user task
      lines.push('');
      lines.push(
        `3. Code changes expected? → \`${contextNewCommand({ chatroomId, role, cliEnvPrefix })}\``
      );
      lines.push('4. Delegate phase 1 to builder:');
      lines.push('```');
      lines.push(
        `${cliEnvPrefix}chatroom handoff --chatroom-id="${chatroomId}" --role="${role}" --next-role=builder << 'EOF'`
      );
      lines.push('---MESSAGE---');
      lines.push('[Your message here]');
      lines.push('EOF');
      lines.push('```');
      if (availableHandoffTargets.length > 0) {
        lines.push(`(targets: ${availableHandoffTargets.join(', ')})`);
      }
    } else {
      // Non-coordinator role receiving a user message
      let nextStepNum = 3;
      if (isEntryPoint) {
        lines.push('');
        lines.push(
          `${nextStepNum}. Code changes expected? → \`${contextNewCommand({ chatroomId, role, cliEnvPrefix })}\``
        );
        nextStepNum++;
      }
      lines.push(`${nextStepNum}. Hand off when complete:`);
      lines.push('```');
      lines.push(
        `${cliEnvPrefix}chatroom handoff --chatroom-id="${chatroomId}" --role="${role}" --next-role=<target> << 'EOF'`
      );
      lines.push('---MESSAGE---');
      lines.push('[Your message here]');
      lines.push('EOF');
      lines.push('```');
      if (availableHandoffTargets.length > 0) {
        lines.push(`(targets: ${availableHandoffTargets.join(', ')})`);
      }
    }
  } else if (message) {
    // Handoff case: read task first (marks in_progress), then work
    lines.push('⚠️  REQUIRED FIRST STEP: Read the task to mark it as in_progress.');
    lines.push(`   handed off from ${message.senderRole} — start work immediately.`);
    lines.push('');

    // Step 1: Read task
    lines.push(
      `1. Read task → \`${cliEnvPrefix}chatroom task read --chatroom-id="${chatroomId}" --role="${role}" --task-id="${task._id}"\``
    );

    let nextStepNum = 2;
    if (isEntryPoint) {
      lines.push(
        `${nextStepNum}. Code changes expected? → \`${contextNewCommand({ chatroomId, role, cliEnvPrefix })}\``
      );
      nextStepNum++;
    }

    lines.push(`${nextStepNum}. Hand off when complete:`);
    lines.push('```');
    lines.push(
      `${cliEnvPrefix}chatroom handoff --chatroom-id="${chatroomId}" --role="${role}" --next-role=<target> << 'EOF'`
    );
    lines.push('---MESSAGE---');
    lines.push('[Your message here]');
    lines.push('EOF');
    lines.push('```');
    if (availableHandoffTargets.length > 0) {
      lines.push(`(targets: ${availableHandoffTargets.join(', ')})`);
    }
  } else {
    lines.push(`No message found. Task ID: ${task._id}`);
  }

  lines.push('</next-steps>');

  // ── Reminder footer ───────────────────────────────────────────────────────

  lines.push('');
  lines.push(SEP_EQUAL);
  lines.push(getNextTaskReminder());
  lines.push(getCompactionRecoveryOneLiner({ cliEnvPrefix, chatroomId, role }));
  lines.push(SEP_EQUAL);

  return lines.join('\n');
}
