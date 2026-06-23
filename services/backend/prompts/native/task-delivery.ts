/**
 * Slim task delivery output for native-integration harnesses.
 *
 * Focus: task content + next steps + handoff templates + handoff commands.
 * No listen-loop, injection, or session-lifecycle framing — the system
 * delivers work; the agent completes it and hands off.
 */

import { appendNativeDeliveryHandoffTemplates } from './delivery-handoff-templates';
import { handoffCommand } from '../cli/handoff/command';

export interface NativeTaskDeliveryParams {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
  teamId?: string;
  task: { _id: string; content: string };
  message: { _id: string; senderRole: string } | null;
  availableHandoffTargets: string[];
  attachedMessages?: { _id: string; content: string; senderRole: string }[];
}

/** Primary handoff target: return work to the task sender, else first available target. */
function inferPrimaryHandoffTarget(
  senderRole: string | undefined,
  role: string,
  availableHandoffTargets: string[]
): string | undefined {
  if (senderRole && senderRole.toLowerCase() !== role.toLowerCase()) {
    return senderRole;
  }
  return availableHandoffTargets[0];
}

function maybeAddUserVerificationReminder(lines: string[], target: string | undefined): void {
  if (target?.toLowerCase() === 'user') {
    lines.push('');
    lines.push(
      'Before handing off to user: verify the codebase is in a good state — run `pnpm typecheck && pnpm test`.'
    );
  }
}

function appendNativeNextSteps(
  lines: string[],
  params: Pick<
    NativeTaskDeliveryParams,
    'chatroomId' | 'role' | 'cliEnvPrefix' | 'message' | 'availableHandoffTargets'
  >
): void {
  const { chatroomId, role, cliEnvPrefix, message, availableHandoffTargets } = params;
  const primaryTarget = inferPrimaryHandoffTarget(
    message?.senderRole,
    role,
    availableHandoffTargets
  );

  lines.push('');
  lines.push('<next-steps>');
  lines.push('1. Work on the task above.');

  if (primaryTarget) {
    const senderNote = message ? ` (task from \`${message.senderRole}\`)` : '';
    lines.push(
      `2. **When complete, you MUST run the handoff command** — this completes your work and delivers it to \`${primaryTarget}\`${senderNote}:`
    );
    maybeAddUserVerificationReminder(lines, primaryTarget);
    lines.push('');
    lines.push('```bash');
    lines.push(handoffCommand({ chatroomId, role, nextRole: primaryTarget, cliEnvPrefix }));
    lines.push('```');
    lines.push('');
    lines.push(
      'Fill in the message using the matching template in `<handoff-templates>` below. **Do not end your turn without running handoff.**'
    );
  } else {
    lines.push(
      '2. **When complete, you MUST run a handoff command** from `<handoffs>` below. **Do not end your turn without running handoff.**'
    );
  }

  lines.push('');
  lines.push('</next-steps>');
}

function appendHandoffTargets(
  lines: string[],
  params: Pick<
    NativeTaskDeliveryParams,
    'chatroomId' | 'role' | 'cliEnvPrefix' | 'availableHandoffTargets'
  >
): void {
  const { chatroomId, role, cliEnvPrefix, availableHandoffTargets } = params;
  if (availableHandoffTargets.length === 0) return;

  lines.push('');
  lines.push('<handoffs>');
  lines.push('Other handoff targets (if you need a different recipient than step 2):');
  lines.push('');

  for (const target of availableHandoffTargets) {
    lines.push(`**${target}**`);
    lines.push('```bash');
    lines.push(handoffCommand({ chatroomId, role, nextRole: target, cliEnvPrefix }));
    lines.push('```');
    lines.push('');
  }

  lines.push('</handoffs>');
}

/** Task body, next steps, templates, and handoff commands. */
export function generateNativeTaskDeliveryOutput(params: NativeTaskDeliveryParams): string {
  const {
    chatroomId,
    role,
    cliEnvPrefix,
    teamId,
    task,
    message,
    availableHandoffTargets,
    attachedMessages = [],
  } = params;

  const lines: string[] = [`<task>`, `Task ID: ${task._id}`];
  if (message) lines.push(`From: ${message.senderRole}`);
  lines.push('', task.content);

  for (const attached of attachedMessages) {
    lines.push('', '<attached>', `From: ${attached.senderRole}`, attached.content, '</attached>');
  }

  lines.push('</task>');
  appendNativeNextSteps(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    message,
    availableHandoffTargets,
  });
  appendNativeDeliveryHandoffTemplates(lines, { teamId, role });
  appendHandoffTargets(lines, { chatroomId, role, cliEnvPrefix, availableHandoffTargets });

  return lines.join('\n').trim();
}
