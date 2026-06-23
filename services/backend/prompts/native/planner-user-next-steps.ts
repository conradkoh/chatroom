/**
 * Native harness injection next-steps for a planner receiving a user message.
 *
 * Lightweight by default: classify then branch. Heavy templates (delegation brief,
 * user report) are referenced from system prompt, not inlined on every injection.
 */

import { appendClassifyNextStepLines } from './classify-next-step';
import { handoffCommand } from '../cli/handoff/command';

export interface NativePlannerUserNextStepsParams {
  chatroomId: string;
  role: string;
  taskId: string;
  cliEnvPrefix: string;
  availableHandoffTargets: string[];
}

/** Append classify + classification-branch guidance for native planner user tasks. */
export function appendNativePlannerUserNextSteps(
  lines: string[],
  params: NativePlannerUserNextStepsParams
): void {
  const { chatroomId, role, taskId, cliEnvPrefix, availableHandoffTargets } = params;

  appendClassifyNextStepLines(lines, { chatroomId, role, taskId, cliEnvPrefix }, 1);

  lines.push('');
  lines.push('2. After classify, follow the path for your classification:');
  lines.push('');
  lines.push(
    '   **question** (greetings, clarifications, no code work): reply to the user via handoff with a brief message. Skip `context new`, builder delegation, and the full report template.'
  );

  const userHandoff = handoffCommand({
    chatroomId,
    role,
    nextRole: 'user',
    cliEnvPrefix,
  }).replace('[Your message here]', '[Your reply to the user]');
  lines.push('```');
  lines.push(userHandoff);
  lines.push('```');

  lines.push('');
  lines.push(
    '   **new_feature** / **follow_up** (planning or code work): set context when starting new work, delegate ONE slice to the builder using the **Builder delegation brief** from your system prompt, verify (`pnpm typecheck && pnpm test`) before delivering to the user when appropriate.'
  );

  if (availableHandoffTargets.length > 0) {
    lines.push(`(handoff targets: ${availableHandoffTargets.join(', ')})`);
  }
}
