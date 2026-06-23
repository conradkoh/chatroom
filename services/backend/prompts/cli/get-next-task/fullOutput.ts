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

import {
  getNativeInjectionReminder,
  getNextTaskReminder,
  getCompactionRecoveryOneLiner,
} from './reminder';
import { classifyCommand } from '../classify/command';
import { contextNewCommand, contextNewHint } from '../context/new';
import { getHandoffTemplate } from '../handoff-templates';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FullCliOutputParams {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
  teamId?: string;

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
    elapsedHours: number;
  } | null;

  /** Origin message for fallback when no explicit context */
  originMessage: {
    senderRole: string;
    content: string;
    classification?: string | null;
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

  /** When true, omit get-next-task language (native harness task injection). */
  nativeIntegration?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * If `user` is among the available handoff targets, add a verification
 * reminder before the handoff command so the planner/coordinator verifies
 * the codebase before delivering to the user.
 */
function maybeAddVerificationReminder(lines: string[], availableHandoffTargets: string[]): void {
  if (availableHandoffTargets.includes('user')) {
    lines.push('');
    lines.push('⚠️ Before delivering to user: Verify the codebase is in a good state.');
    lines.push('   Run: pnpm typecheck && pnpm test');
  }
}

function getNextStepsIntro(nativeIntegration: boolean): string {
  return nativeIntegration
    ? 'This task was injected into your native harness session. Infer what to do from the message—it is the source of truth. Numbered steps below are typical role patterns, not a rigid script.'
    : 'This blocking `get-next-task` resolved because the user or team message is ready as a chatroom task. Infer what to do from that message—it is the source of truth. Numbered steps below are typical role patterns, not a rigid script.';
}

function getReminderFooter(nativeIntegration: boolean): string {
  return nativeIntegration ? getNativeInjectionReminder() : getNextTaskReminder();
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
    teamId,
    task,
    message,
    currentContext,
    originMessage,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
    isEntryPoint,
    availableHandoffTargets,
    nativeIntegration = false,
  } = params;

  const lines: string[] = [];
  const SEP_EQUAL = '='.repeat(60);

  const isUserMessage = message && message.senderRole.toLowerCase() === 'user';

  // ── Task section (IDs + context + content + backlog) ──────────────────────

  lines.push('<task>');
  lines.push(SEP_EQUAL);
  lines.push('📋 CHATROOM TASK');
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

    // Time-based staleness: soft warning at >= 4h, hard warning at >= 24h.
    // The count-based "messages since context" signal was removed in favor of
    // pure time-based staleness (zero per-call message-doc reads).
    if (currentContext.elapsedHours >= 24) {
      const ageDays = Math.floor(currentContext.elapsedHours / 24);
      lines.push('');
      lines.push(`⚠️ Context is ${ageDays}d old.`);
      if (isEntryPoint) {
        lines.push(
          `   Update → \`${cliEnvPrefix}chatroom context new --chatroom-id="${chatroomId}" --role="${role}" --content="<summary>"\``
        );
      }
    } else if (currentContext.elapsedHours >= 4) {
      const ageHours = Math.floor(currentContext.elapsedHours);
      lines.push('');
      lines.push(`⚠️ Context is ${ageHours}h old — consider refreshing if stale.`);
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

  // Task content — CLI harnesses hide content behind task read; native injects inline
  lines.push('');
  lines.push('## Chatroom task');
  if (nativeIntegration) {
    lines.push('');
    lines.push('<task-content>');
    lines.push(task.content);
    lines.push('</task-content>');
    lines.push('');
    lines.push(
      'Task content is delivered above. When you begin responding, the system marks this chatroom task as in_progress automatically — do not run `task read`.'
    );
  } else {
    lines.push(`To read this chatroom task and mark it as in_progress, run:`);
    lines.push('```');
    lines.push(
      `${cliEnvPrefix}chatroom task read --chatroom-id="${chatroomId}" --role="${role}" --task-id="${task._id}"`
    );
    lines.push('```');
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
  lines.push(getNextStepsIntro(nativeIntegration));
  lines.push('');

  if (isUserMessage) {
    if (!nativeIntegration) {
      lines.push('⚠️  REQUIRED FIRST STEP: Read the chatroom task to mark it as in_progress.');
      lines.push('');
      lines.push(
        `1. Read chatroom task → \`${cliEnvPrefix}chatroom task read --chatroom-id="${chatroomId}" --role="${role}" --task-id="${task._id}"\``
      );
    }

    const classifyStepNum = nativeIntegration ? 1 : 2;
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
    lines.push(`${classifyStepNum}. Classify → \`${baseCmd}\``);

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
      const contextStepNum = nativeIntegration ? 2 : 3;
      const delegateStepNum = nativeIntegration ? 3 : 4;
      const reportStepNum = nativeIntegration ? 4 : 5;
      // Planner role receiving a new user task
      lines.push('');
      lines.push(
        `${contextStepNum}. Set a new context per user message (default) → \`${contextNewCommand({ chatroomId, role, cliEnvPrefix })}\` — skip ONLY when the message is clearly a follow-up of the current chatroom task.`
      );
      lines.push(contextNewHint());
      lines.push(
        `${delegateStepNum}. Delegate ONE slice to the builder (a structured workflow is optional, not required):`
      );
      lines.push('');
      lines.push(getHandoffTemplate({ teamId, fromRole: 'planner', toRole: 'builder' }) ?? '');
      lines.push('```');
      lines.push(
        `${cliEnvPrefix}chatroom handoff --chatroom-id="${chatroomId}" --role="${role}" --next-role=builder << 'EOF'`
      );
      lines.push('---MESSAGE---');
      lines.push('[Your delegation brief here]');
      lines.push('EOF');
      lines.push('```');
      if (availableHandoffTargets.length > 0) {
        lines.push(`(targets: ${availableHandoffTargets.join(', ')})`);
      }
      // Eagerly deliver the report template so it shapes the final deliverable
      // from the start — the user can only ever see the handoff-to-user message.
      lines.push('');
      lines.push(
        `${reportStepNum}. When the work is done, deliver to the user using this report template:`
      );
      maybeAddVerificationReminder(lines, availableHandoffTargets);
      lines.push('');
      lines.push(getHandoffTemplate({ teamId, fromRole: 'planner', toRole: 'user' }) ?? '');
    } else {
      // Non-coordinator role receiving a user message
      let nextStepNum = nativeIntegration ? 2 : 3;
      if (isEntryPoint) {
        lines.push('');
        lines.push(
          `${nextStepNum}. Set a new context per user message (default) → \`${contextNewCommand({ chatroomId, role, cliEnvPrefix })}\` — skip ONLY when the message is clearly a follow-up of the current chatroom task.`
        );
        lines.push(contextNewHint());
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
    if (!nativeIntegration) {
      lines.push('⚠️  REQUIRED FIRST STEP: Read the chatroom task to mark it as in_progress.');
      lines.push(`   handed off from ${message.senderRole} — start work immediately.`);
      lines.push('');
      lines.push(
        `1. Read chatroom task → \`${cliEnvPrefix}chatroom task read --chatroom-id="${chatroomId}" --role="${role}" --task-id="${task._id}"\``
      );
    } else {
      lines.push(`handed off from ${message.senderRole} — start work immediately.`);
      lines.push('');
    }

    let nextStepNum = nativeIntegration ? 1 : 2;
    if (isEntryPoint) {
      lines.push(
        `${nextStepNum}. Set a new context per user message (default) → \`${contextNewCommand({ chatroomId, role, cliEnvPrefix })}\` — skip ONLY when the message is clearly a follow-up of the current chatroom task.`
      );
      lines.push(contextNewHint());
      nextStepNum++;
    }

    lines.push(`${nextStepNum}. Hand off when complete:`);
    maybeAddVerificationReminder(lines, availableHandoffTargets);
    const primaryTarget = availableHandoffTargets[0];
    if (primaryTarget) {
      const tmpl = getHandoffTemplate({ teamId, fromRole: role, toRole: primaryTarget });
      if (tmpl) {
        lines.push('');
        lines.push(tmpl);
      }
    }
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
  lines.push(getReminderFooter(nativeIntegration));
  if (!nativeIntegration) {
    lines.push(getCompactionRecoveryOneLiner({ cliEnvPrefix, chatroomId, role }));
  }
  lines.push(SEP_EQUAL);

  return lines.join('\n');
}
