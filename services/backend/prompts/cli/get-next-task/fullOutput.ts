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

import { getNextTaskCommand } from './command';
import { getNextTaskReminder, getCompactionRecoveryNote } from './reminder';
import { contextNewCommand } from '../context/new';
import { reportProgressCommand } from '../report-progress/command';
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

  // ── Compaction recovery note ───────────────────────────────────────────────

  lines.push(getCompactionRecoveryNote({ cliEnvPrefix, chatroomId, role }));
  lines.push('');

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
    lines.push('<context>');
    lines.push(currentContext.content);

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

  // ── Process section ─────────────────────────────────────────────────────

  lines.push('');
  lines.push('<process>');
  lines.push(SEP_EQUAL);
  lines.push('📋 PROCESS');
  lines.push(SEP_EQUAL);

  let stepNum = 1;

  if (isEntryPoint) {
    lines.push(
      `${stepNum}. Code changes expected? → \`${contextNewCommand({ chatroomId, role, cliEnvPrefix })}\``
    );
    stepNum++;
  }

  if (isUserMessage) {
    lines.push(
      `${stepNum}. Acknowledge → \`${taskStartedCommand({ chatroomId, role, taskId: task._id, classification: 'follow_up', cliEnvPrefix })}\``
    );
  } else {
    lines.push(
      `${stepNum}. Acknowledge → \`${cliEnvPrefix}chatroom task-started --chatroom-id="${chatroomId}" --role="${role}" --task-id="${task._id}" --no-classify\``
    );
  }
  stepNum++;

  lines.push(
    `${stepNum}. (optional) Read context if needed → \`${cliEnvPrefix}chatroom context read --chatroom-id="${chatroomId}" --role="${role}"\` _(skip if you already have full context)_`
  );
  stepNum++;

  lines.push(
    `${stepNum}. Report progress at milestones → \`${reportProgressCommand({ chatroomId, role, cliEnvPrefix })}\``
  );
  stepNum++;

  lines.push(`${stepNum}. Do the work`);
  stepNum++;

  if (availableHandoffTargets.length > 0) {
    lines.push(
      `${stepNum}. Hand off (targets: ${availableHandoffTargets.join(', ')}) → \`${cliEnvPrefix}chatroom handoff --chatroom-id="${chatroomId}" --role="${role}" --next-role=<target> << 'EOF'\n---MESSAGE---\n[Your message here]\nEOF\``
    );
  } else {
    lines.push(
      `${stepNum}. Hand off → \`${cliEnvPrefix}chatroom handoff --chatroom-id="${chatroomId}" --role="${role}" --next-role=<target> << 'EOF'\n---MESSAGE---\n[Your message here]\nEOF\``
    );
  }
  stepNum++;

  lines.push(`${stepNum}. Resume → \`${getNextTaskCommand({ chatroomId, role, cliEnvPrefix })}\``);

  lines.push('');
  lines.push('Reference commands:');
  lines.push(
    `  messages → \`${cliEnvPrefix}chatroom messages list --chatroom-id="${chatroomId}" --role="${role}" --sender-role=user --limit=5 --full\``
  );
  lines.push(
    `  backlog → \`${cliEnvPrefix}chatroom backlog list --chatroom-id="${chatroomId}" --role="${role}" --status=backlog\``
  );
  lines.push('  git log → `git log --oneline -10`');

  lines.push('</process>');

  // ── Next Steps ──────────────────────────────────────────────────────────

  lines.push('');
  lines.push('<next-steps>');
  lines.push(SEP_EQUAL);
  lines.push('📋 NEXT STEPS');
  lines.push(SEP_EQUAL);

  if (isUserMessage) {
    // Classification command with placeholder
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

    lines.push('');
    lines.push('```mermaid');
    lines.push('flowchart TD');
    lines.push('    A([Start]) --> B[Read user message]');
    lines.push('    B --> C{message type?}');
    lines.push('    C -->|question or follow_up| D[Classify with --origin-message-classification=type]');
    lines.push('    C -->|new_feature| E["Classify with --origin-message-classification=new_feature\nrequires --title, --description, --tech-specs"]');
    lines.push('    D --> F([Stop])');
    lines.push('    E --> F');
    lines.push('```');

    lines.push('');
    lines.push(`Classify → \`${baseCmd}\``);

    // new_feature example
    lines.push('');
    lines.push('new_feature example:');
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

    if (role === 'planner') {
      // Planner role receiving a new user task — show phase-planning loop
      lines.push('');
      lines.push('**Phase Planning Loop:**');
      lines.push('```mermaid');
      lines.push('flowchart TD');
      lines.push('    A([Start]) --> B[Classify and understand the task]');
      lines.push('    B --> C[Break task into phases]');
      lines.push('    C --> D[Delegate ONE phase to builder]');
      lines.push("    D --> E[Builder completes phase]");
      lines.push("    E --> F[Review builder's work]");
      lines.push('    F --> G{phase accepted?}');
      lines.push('    G -->|no| H[Send back with feedback]');
      lines.push('    H --> D');
      lines.push('    G -->|yes| I{more phases?}');
      lines.push('    I -->|yes| D');
      lines.push('    I -->|no| J[Deliver final result to user]');
      lines.push('    J --> K([Stop])');
      lines.push('```');
      lines.push('');
      lines.push(
        `2. Code changes expected? → \`${contextNewCommand({ chatroomId, role, cliEnvPrefix })}\``
      );
      lines.push('3. Delegate phase 1 to builder:');
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
      // Non-coordinator role receiving a user message (entry-point implementer or non-entry-point)
      let nextStepNum = 2;
      if (isEntryPoint) {
        lines.push('');
        lines.push(
          `${nextStepNum}. Code changes expected? → \`${contextNewCommand({ chatroomId, role, cliEnvPrefix })}\``
        );
        nextStepNum++;
      }
      lines.push(`${nextStepNum}. Do the work → follow PROCESS above`);
      nextStepNum++;
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
    lines.push('');
    lines.push(`handed off from ${message.senderRole} — start work immediately.`);

    let nextStepNum = 1;
    if (isEntryPoint) {
      lines.push(
        `${nextStepNum}. Code changes expected? → \`${contextNewCommand({ chatroomId, role, cliEnvPrefix })}\``
      );
      nextStepNum++;
    }

    lines.push(`${nextStepNum}. Do the work → follow PROCESS above`);
    nextStepNum++;
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
    lines.push('');
    lines.push(`No message found. Task ID: ${task._id}`);
  }

  lines.push('</next-steps>');

  // ── Reminder footer ───────────────────────────────────────────────────────

  lines.push('');
  lines.push(SEP_EQUAL);
  lines.push(getNextTaskReminder());
  lines.push(SEP_EQUAL);

  return lines.join('\n');
}
