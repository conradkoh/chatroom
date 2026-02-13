/**
 * Full CLI output generator for wait-for-task task delivery.
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

import { waitForTaskCommand } from './command.js';
import { getWaitForTaskReminder } from './reminder.js';
import { contextNewCommand } from '../context/new.js';
import { reportProgressCommand } from '../report-progress/command.js';
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
    lines.push(`Message ID: ${message._id}`);
  }

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
      if (isEntryPoint) {
        lines.push('   Consider updating the context with a summary of recent developments.');
        lines.push('   Create a new context with:');
        lines.push(
          `   ${cliEnvPrefix}chatroom context new --chatroom-id=${chatroomId} --role=${role} --content="<summary>"`
        );
      } else {
        lines.push(
          '   The context may be outdated. The entry point role will update it when needed.'
        );
      }
    }

    // Staleness warning: old context
    if (currentContext.elapsedHours >= 24) {
      const ageDays = Math.floor(currentContext.elapsedHours / 24);
      lines.push('');
      lines.push(`⚠️  WARNING: This context is ${ageDays} day(s) old.`);
      if (isEntryPoint) {
        lines.push('   Consider creating a new context with updated summary.');
        lines.push(
          `   ${cliEnvPrefix}chatroom context new --chatroom-id=${chatroomId} --role=${role} --content="<summary>"`
        );
      } else {
        lines.push(
          '   The context may be outdated. The entry point role will update it when needed.'
        );
      }
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
      if (isEntryPoint) {
        lines.push('   Consider creating a context with:');
        lines.push(
          `   ${cliEnvPrefix}chatroom context new --chatroom-id=${chatroomId} --role=${role} --content="<summary>"`
        );
      } else {
        lines.push(
          '   The context may be outdated. The entry point role will update it when needed.'
        );
      }
    }

    // Staleness warning: old pinned message
    if (originMessageCreatedAt) {
      const ageMs = Date.now() - originMessageCreatedAt;
      const ageHours = ageMs / (1000 * 60 * 60);
      if (ageHours >= 24) {
        const ageDays = Math.floor(ageHours / 24);
        lines.push('');
        lines.push(`⚠️  WARNING: This pinned message is ${ageDays} day(s) old.`);
        if (isEntryPoint) {
          lines.push('   Consider creating a context with:');
          lines.push(
            `   ${cliEnvPrefix}chatroom context new --chatroom-id=${chatroomId} --role=${role} --content="<summary>"`
          );
        } else {
          lines.push(
            '   The context may be outdated. The entry point role will update it when needed.'
          );
        }
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

  lines.push('</task>');

  // ── Process section (consolidated with inline guidance) ──────────────────

  lines.push('');
  lines.push('<process>');
  lines.push(SEP_EQUAL);
  lines.push('📋 PROCESS');
  lines.push(SEP_EQUAL);

  let stepNum = 1;

  // Step: Set context (entry point only, when code changes expected)
  if (isEntryPoint) {
    lines.push('');
    lines.push(`${stepNum}. If code changes / commits are expected, set a new context:`);
    lines.push(`   ${contextNewCommand({ chatroomId, role, cliEnvPrefix })}`);
    stepNum++;
  }

  // Step: Mark task as started
  lines.push('');
  lines.push(`${stepNum}. Mark task as started:`);
  if (isUserMessage) {
    lines.push(
      `   ${taskStartedCommand({ chatroomId, role, taskId: task._id, classification: 'follow_up', cliEnvPrefix })}`
    );
  } else {
    lines.push(
      `   ${cliEnvPrefix}chatroom task-started --chatroom-id=${chatroomId} --role=${role} --task-id=${task._id} --no-classify`
    );
  }
  stepNum++;

  // Step: Report progress
  lines.push('');
  lines.push(`${stepNum}. Report progress frequently — small, incremental updates as you work:`);
  lines.push(`   ${reportProgressCommand({ chatroomId, role, cliEnvPrefix })}`);
  lines.push('');
  lines.push('   Keep updates short and frequent (e.g. after each milestone or subtask).');
  stepNum++;

  // Step: Do the work (with available commands)
  lines.push('');
  lines.push(`${stepNum}. Do the work`);
  lines.push('');
  lines.push('   Available commands:');
  lines.push(
    `   • Read context: ${cliEnvPrefix}chatroom context read --chatroom-id=${chatroomId} --role=${role}`
  );
  lines.push(
    `   • List messages: ${cliEnvPrefix}chatroom messages list --chatroom-id=${chatroomId} --role=${role} --sender-role=user --limit=5 --full`
  );
  lines.push('   • View code changes: git log --oneline -10');
  lines.push(
    `   • Complete task (no handoff): ${cliEnvPrefix}chatroom task-complete --chatroom-id=${chatroomId} --role=${role}`
  );
  lines.push(
    `   • View backlog: ${cliEnvPrefix}chatroom backlog list --chatroom-id=${chatroomId} --role=${role} --status=backlog`
  );
  stepNum++;

  // Step: Hand off when complete (with targets)
  lines.push('');
  lines.push(`${stepNum}. Hand off when complete:`);
  lines.push(
    `   ${cliEnvPrefix}chatroom handoff --chatroom-id=${chatroomId} --role=${role} --next-role=<target>`
  );
  if (availableHandoffTargets.length > 0) {
    lines.push(`   Available targets: ${availableHandoffTargets.join(', ')}`);
  }
  stepNum++;

  // Step: Resume listening
  lines.push('');
  lines.push(`${stepNum}. Resume listening:`);
  lines.push(`   ${waitForTaskCommand({ chatroomId, role, cliEnvPrefix })}`);

  lines.push('</process>');

  // ── Next Steps (directive classification/handoff instructions) ───────────

  lines.push('');
  lines.push('<next-steps>');
  lines.push(SEP_EQUAL);
  lines.push('📋 NEXT STEPS');
  lines.push(SEP_EQUAL);

  let nextStepNum = 1;

  if (isUserMessage) {
    lines.push('');
    lines.push(`Step ${nextStepNum}. Acknowledge and classify this message:`);
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

    lines.push('');
    lines.push('Classification types: question, new_feature, follow_up');
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
    nextStepNum++;

    // Context creation step (entry point only)
    if (isEntryPoint) {
      lines.push('');
      lines.push(
        `Step ${nextStepNum}. If code changes are expected, create a new context before starting work:`
      );
      lines.push(`   ${contextNewCommand({ chatroomId, role, cliEnvPrefix })}`);
      nextStepNum++;
    }

    lines.push('');
    lines.push(`Step ${nextStepNum}. Do the work following the PROCESS section above.`);
    nextStepNum++;
    lines.push('');
    lines.push(`Step ${nextStepNum}. Hand off when complete.`);
  } else if (message) {
    lines.push('');
    lines.push(
      `Step ${nextStepNum}. Task handed off from ${message.senderRole} — start work immediately.`
    );
    nextStepNum++;

    // Context creation step (entry point only)
    if (isEntryPoint) {
      lines.push('');
      lines.push(
        `Step ${nextStepNum}. If code changes are expected, create a new context before starting work:`
      );
      lines.push(`   ${contextNewCommand({ chatroomId, role, cliEnvPrefix })}`);
      nextStepNum++;
    }

    lines.push('');
    lines.push(`Step ${nextStepNum}. Do the work following the PROCESS section above.`);
    nextStepNum++;
    lines.push('');
    lines.push(`Step ${nextStepNum}. Hand off when complete.`);
  } else {
    lines.push('');
    lines.push(`No message found. Task ID: ${task._id}`);
  }

  lines.push('</next-steps>');

  // ── Reminder footer ───────────────────────────────────────────────────────

  lines.push('');
  lines.push(SEP_EQUAL);
  lines.push(getWaitForTaskReminder());
  lines.push(SEP_EQUAL);

  return lines.join('\n');
}
