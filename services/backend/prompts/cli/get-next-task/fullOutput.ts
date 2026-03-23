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
import { classifyCommand } from '../classify/command';
import { contextNewCommand } from '../context/new';

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
      _id: string;
      status: string;
      content: string;
    }[];
    attachedMessages?: {
      _id: string;
      content: string;
      senderRole: string;
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

  /** Active workflow context (if any) */
  activeWorkflow?: {
    workflowKey: string;
    status: string;
    steps: {
      stepKey: string;
      description: string;
      status: string;
      assigneeRole?: string;
      dependsOn: string[];
      goal?: string;
      requirements?: string;
      warnings?: string;
    }[];
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * If `user` is among the available handoff targets, add a verification
 * reminder before the handoff command so the planner/coordinator verifies
 * the codebase before delivering to the user.
 */
function maybeAddVerificationReminder(
  lines: string[],
  availableHandoffTargets: string[]
): void {
  if (availableHandoffTargets.includes('user')) {
    lines.push('');
    lines.push('⚠️ Before delivering to user: Verify the codebase is in a good state.');
    lines.push('   Run: pnpm typecheck && pnpm test');
  }
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
    activeWorkflow,
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
  const legacyTasks = originMessage?.attachedTasks ?? [];
  const backlogItems = originMessage?.attachedBacklogItems ?? [];
  const totalAttached = legacyTasks.length + backlogItems.length;

  if (totalAttached > 0) {
    lines.push('');
    lines.push(`## Attached Backlog (${totalAttached})`);

    // Legacy tasks (no _id available — render as plain lines)
    for (const attached of legacyTasks) {
      lines.push(`- [${attached.status.toUpperCase()}] ${attached.content}`);
    }

    // Backlog items (with _id — wrap in <backlog-item> tags)
    for (const attached of backlogItems) {
      lines.push('<backlog-item>');
      lines.push(`- [${attached.status.toUpperCase()}] ${attached.content}`);
      lines.push(`  ID: ${attached._id}`);
      lines.push('</backlog-item>');
    }

    // System info hint (only when backlog items with IDs are present)
    if (backlogItems.length > 0) {
      lines.push('<system-info>');
      lines.push(
        'HINT: If you have completed work on a backlog item and it is ready for review, run:'
      );
      lines.push(
        `  ${cliEnvPrefix}chatroom backlog mark-for-review --chatroom-id="${chatroomId}" --role="${role}" --backlog-item-id=<id>`
      );
      lines.push('</system-info>');
    }
  }

  // Attached messages from origin message (user-pinned messages as context)
  const attachedMessages = originMessage?.attachedMessages ?? [];
  if (attachedMessages.length > 0) {
    lines.push('');
    lines.push(`## Attached Messages (${attachedMessages.length})`);
    for (const attached of attachedMessages) {
      lines.push('<attached-message>');
      lines.push(`From: ${attached.senderRole}`);
      lines.push(`ID: ${attached._id}`);
      lines.push('---');
      lines.push(attached.content);
      lines.push('</attached-message>');
    }
  }

  // Active workflow context
  if (activeWorkflow && activeWorkflow.status === 'active') {
    lines.push('');
    lines.push('## Active Workflow');
    lines.push(`Key: ${activeWorkflow.workflowKey} | Status: ${activeWorkflow.status}`);

    // Show step summary
    const statusEmoji: Record<string, string> = {
      pending: '⏳',
      in_progress: '🔵',
      completed: '✅',
      cancelled: '❌',
    };
    lines.push('');
    lines.push('Steps:');
    for (const step of activeWorkflow.steps) {
      const emoji = statusEmoji[step.status] || '❓';
      const assignee = step.assigneeRole ? ` (${step.assigneeRole})` : '';
      lines.push(`  ${emoji} ${step.stepKey}${assignee} — ${step.description}`);
    }

    // Show steps assigned to this role
    const mySteps = activeWorkflow.steps.filter(
      (s) => s.assigneeRole?.toLowerCase() === role.toLowerCase() && s.status === 'in_progress'
    );

    if (mySteps.length > 0) {
      lines.push('');
      lines.push('### Your Active Steps');
      for (const step of mySteps) {
        lines.push(`**Step: ${step.stepKey}** — ${step.description}`);
        if (step.goal) {
          lines.push('Goal:');
          lines.push(step.goal);
        }
        if (step.requirements) {
          lines.push('Requirements:');
          lines.push(step.requirements);
        }
        if (step.warnings) {
          lines.push('Warnings:');
          lines.push(step.warnings);
        }
        lines.push('');
        lines.push(
          `When done: \`${cliEnvPrefix}chatroom workflow step-complete --chatroom-id="${chatroomId}" --role="${role}" --workflow-key="${activeWorkflow.workflowKey}" --step-key="${step.stepKey}"\``
        );
      }
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
    const baseCmd = classifyCommand({
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
      `   ${classifyCommand({
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
      maybeAddVerificationReminder(lines, availableHandoffTargets);
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
      maybeAddVerificationReminder(lines, availableHandoffTargets);
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
    maybeAddVerificationReminder(lines, availableHandoffTargets);
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

  // If active workflow, add status command hint and restriction notice
  if (activeWorkflow && activeWorkflow.status === 'active') {
    lines.push('');
    lines.push(
      `Workflow status: \`${cliEnvPrefix}chatroom workflow status --chatroom-id="${chatroomId}" --role="${role}" --workflow-key="${activeWorkflow.workflowKey}"\``
    );
    lines.push('');
    lines.push(
      `⚠️ Workflow "${activeWorkflow.workflowKey}" is active — handoff to user is blocked until workflow completes or is exited.`
    );
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
