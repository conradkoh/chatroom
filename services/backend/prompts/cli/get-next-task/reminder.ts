/**
 * Get-next-task reminder prompts.
 *
 * Provides structured reminders about maintaining message availability.
 * Follows prompt engineering guidelines: outcome-driven with rationale.
 */

import {
  messagesAnchorCommand,
  messagesDownloadSinceCommand,
} from '../../utils/proof-of-verification';
import { isVerifierRole } from '../../utils/verifier-role';

/** Identity values every compaction reminder names. */
export interface CompactionRecoveryParams {
  cliEnvPrefix: string;
  chatroomId: string;
  role: string;
}

/**
 * Get the primary get-next-task reminder.
 * Used in commands section and task delivery.
 *
 * Format: Single line, positive framing, clear consequence
 */
export function getNextTaskReminder(): string {
  return 'A foreground `get-next-task` blocks until the user or team message is ready, then resolves with that message as a chatroom task—treat the message content as the source of truth for what to do. Message availability requires exactly one such blocking tool call; the harness delivers chatroom tasks only while it blocks. Duplicate or backgrounded listeners can acknowledge tasks early and trigger grace-period cooldowns where your active session receives nothing.';
}

/**
 * @deprecated Use getNextTaskReminder instead.
 */
export const getWaitForTaskReminder = getNextTaskReminder;

/**
 * Get extended get-next-task guidance.
 * Used in initialization to explain proper usage.
 */
export function getNextTaskGuidance(): string {
  return `🔗 STAYING CONNECTED TO YOUR TEAM

Your primary directive: Stay available to receive chatroom tasks from your team.

When the user or team is ready, your blocking \`get-next-task\` resolves and delivers their message as the next chatroom task. That message content is the source of truth for what to do.

The harness delivers the next chatroom task only through a single foreground \`get-next-task\` that blocks as a tool call. After completing work and handing off, that blocking listener is what keeps you connected to your team.

Exactly one active waiter should own task delivery at a time. Additional or backgrounded \`get-next-task\` sessions can acknowledge incoming tasks early, causing grace-period conflicts where your active agent receives nothing.

After interruption or restart: complete any in-progress work, then restore a single foreground blocking \`get-next-task\` so chatroom tasks can arrive again.`;
}

/**
 * @deprecated Use getNextTaskGuidance instead.
 */
export const getWaitForTaskGuidance = getNextTaskGuidance;

/** Every role recovers by downloading its task's log from the anchored message id. */
function logDownloadCommand(params: CompactionRecoveryParams): string {
  return messagesDownloadSinceCommand({
    chatroomId: params.chatroomId,
    role: params.role,
    cliEnvPrefix: params.cliEnvPrefix,
    sinceMessageId: '<user-message-id>',
    limit: 100,
  });
}

/** Prints the current task's user message id, which seeds the log download. */
function anchorCommand(params: CompactionRecoveryParams): string {
  return messagesAnchorCommand({
    chatroomId: params.chatroomId,
    role: params.role,
    cliEnvPrefix: params.cliEnvPrefix,
  });
}

/** The `get-system-prompt` clause both reminders share. */
function reloadPromptCommand(params: CompactionRecoveryParams): string {
  return `${params.cliEnvPrefix}chatroom get-system-prompt --chatroom-id="${params.chatroomId}" --role="${params.role}"`;
}

/**
 * Get the compaction/summarization recovery note.
 * Used in the system prompt's Getting Started section for durable agent recovery guidance.
 *
 * Every role runs the same three steps: reload the system and role prompt,
 * anchor on the user message id, and download the log from that id. Only the
 * noun for that user message differs: the verifier's verification request, or
 * the current task for every other role.
 *
 * @param params - Contains real values for cliEnvPrefix, chatroomId, and role
 */
export function getCompactionRecoveryNote(params: CompactionRecoveryParams): string {
  const reload = reloadPromptCommand(params);
  const subject = isVerifierRole(params.role) ? 'your verification request' : 'your current task';
  return `NOTE: If you are an agent that has undergone compaction or summarization, run:
  ${reload}
to reload your full system and role prompt. Then run:
  ${anchorCommand(params)}
to print the user message id of ${subject}, then download the log from that id, replacing \`<user-message-id>\` with the printed id:
  ${logDownloadCommand(params)}`;
}

/**
 * Get a compact one-liner compaction recovery reminder for task delivery.
 * Shown in the reminder footer of every task delivery as a quick nudge.
 * The full version lives in the system prompt's Getting Started section.
 *
 * Every role, the verifier included, anchors on its user message id and
 * re-reads the log.
 *
 * @param params - Contains real values for cliEnvPrefix, chatroomId, and role
 */
export function getCompactionRecoveryOneLiner(params: CompactionRecoveryParams): string {
  const reload = reloadPromptCommand(params);
  return `Context compacted? Run \`${reload}\` to reload prompt, then \`${anchorCommand(params)}\` for the user message id, and \`${logDownloadCommand(params)}\` with that id in place of \`<user-message-id>\` to re-read the log.`;
}
