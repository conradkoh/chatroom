/**
 * Full CLI output generator for get-next-task task delivery.
 *
 * Generates the complete text output that the CLI prints when a task is received.
 * This centralizes all structural template generation in the backend,
 * making the CLI a thin client that just prints the result.
 *
 * The output includes:
 * - Task section (IDs, context, task content, attached backlog)
 * - Process section (step-by-step workflow)
 * - Next Steps section (handoff instructions)
 * - Reminder footer
 */

import { getNextTaskReminder, getCompactionRecoveryOneLiner } from './reminder';
import { getTokenActivityInProgressNote } from '../../base/shared/token-activity-note';
import { generateNativeTaskDeliveryOutput } from '../../native/task-delivery';
import { inferPrimaryHandoffTarget } from '../../utils/infer-primary-handoff-target';
import { getUserVerificationReminder } from '../../utils/task-verification';
import { contextNewCommand, contextNewHint } from '../context/new';
import { handoffCommand } from '../handoff/command';
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

  /** Available handoff targets for this role (e.g. ['builder', 'planner', 'user']) */
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
function maybeAddVerificationReminder(
  lines: string[],
  availableHandoffTargets: string[],
  taskContent: string
): void {
  if (!availableHandoffTargets.includes('user')) {
    return;
  }
  lines.push('');
  lines.push(getUserVerificationReminder(taskContent));
}

function getNextStepsIntro(): string {
  return 'This blocking `get-next-task` resolved because the user or team message is ready as a chatroom task. Infer what to do from that message—it is the source of truth. Numbered steps below are typical role patterns, not a rigid script.';
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

  if (nativeIntegration) {
    const attachedMessages = originMessage?.attachedMessages ?? [];
    return generateNativeTaskDeliveryOutput({
      chatroomId,
      role,
      cliEnvPrefix,
      teamId,
      task,
      message: message ? { _id: message._id, senderRole: message.senderRole } : null,
      availableHandoffTargets,
      attachedMessages,
      isEntryPoint,
    });
  }

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

  // Task content — inline (same as native injection; harness stdout marks in_progress)
  lines.push('');
  lines.push('## Chatroom task');
  lines.push(task.content);
  lines.push('');
  lines.push(getTokenActivityInProgressNote());

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

  lines.push('</task>');

  // ── Next Steps ──────────────────────────────────────────────────────────

  lines.push('');
  lines.push('<next-steps>');
  lines.push(getNextStepsIntro());
  lines.push('');

  if (isUserMessage) {
    lines.push('1. Work on the task above.');

    if (role === 'planner') {
      const contextStepNum = 2;
      const delegateStepNum = 3;
      const reportStepNum = 4;
      // Planner role receiving a new user task
      lines.push('');
      lines.push(
        `${contextStepNum}. Set a new context per user message (default) → \`${contextNewCommand({ chatroomId, role, cliEnvPrefix })}\` — skip ONLY when the message is clearly a follow-up of the current chatroom task.`
      );
      lines.push(contextNewHint());
      lines.push(`${delegateStepNum}. Delegate ONE slice to the builder:`);
      lines.push('');
      lines.push(getHandoffTemplate({ teamId, fromRole: 'planner', toRole: 'builder' }) ?? '');
      lines.push('```bash');
      lines.push(
        handoffCommand({
          chatroomId,
          role,
          nextRole: 'builder',
          cliEnvPrefix,
          messagePlaceholder: '[Your delegation brief here]',
        })
      );
      lines.push('```');
      if (availableHandoffTargets.length > 0) {
        lines.push(`(targets: ${availableHandoffTargets.join(', ')})`);
      }
      lines.push('');
      lines.push(
        `${reportStepNum}. When the work is done, deliver to the user using this report template:`
      );
      maybeAddVerificationReminder(lines, availableHandoffTargets, task.content);
      lines.push('');
      lines.push(getHandoffTemplate({ teamId, fromRole: 'planner', toRole: 'user' }) ?? '');
    } else {
      // Non-coordinator role receiving a user message
      let nextStepNum = 2;
      if (isEntryPoint) {
        lines.push('');
        lines.push(
          `${nextStepNum}. Set a new context per user message (default) → \`${contextNewCommand({ chatroomId, role, cliEnvPrefix })}\` — skip ONLY when the message is clearly a follow-up of the current chatroom task.`
        );
        lines.push(contextNewHint());
        nextStepNum++;
      }
      lines.push(`${nextStepNum}. Hand off when complete:`);
      maybeAddVerificationReminder(lines, availableHandoffTargets, task.content);
      lines.push('```bash');
      lines.push(handoffCommand({ chatroomId, role, cliEnvPrefix }));
      lines.push('```');
      if (availableHandoffTargets.length > 0) {
        lines.push(`(targets: ${availableHandoffTargets.join(', ')})`);
      }
    }
  } else if (message) {
    lines.push('1. Work on the task above.');
    lines.push(`   handed off from ${message.senderRole} — start work immediately.`);

    let nextStepNum = 2;
    if (isEntryPoint) {
      lines.push(
        `${nextStepNum}. Set a new context per user message (default) → \`${contextNewCommand({ chatroomId, role, cliEnvPrefix })}\` — skip ONLY when the message is clearly a follow-up of the current chatroom task.`
      );
      lines.push(contextNewHint());
      nextStepNum++;
    }

    lines.push(`${nextStepNum}. Hand off when complete:`);
    maybeAddVerificationReminder(lines, availableHandoffTargets, task.content);
    const primaryTarget =
      inferPrimaryHandoffTarget({
        senderRole: message.senderRole,
        role,
        availableHandoffTargets,
        isEntryPoint,
      }) ?? availableHandoffTargets[0];
    if (primaryTarget) {
      const tmpl = getHandoffTemplate({ teamId, fromRole: role, toRole: primaryTarget });
      if (tmpl) {
        lines.push('');
        lines.push(tmpl);
      }
    }
    lines.push('```bash');
    lines.push(handoffCommand({ chatroomId, role, cliEnvPrefix }));
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
