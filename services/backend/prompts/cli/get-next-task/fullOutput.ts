/**
 * Full CLI output generator for get-next-task task delivery.
 *
 * Generates the complete text output that the CLI prints when a task is received.
 * This centralizes all structural template generation in the backend,
 * making the CLI a thin client that just prints the result.
 *
 * The output includes:
 * - Task section (IDs, context, attachments, task content)
 * - Process section (step-by-step workflow)
 * - Next Steps section (handoff instructions)
 * - Reminder footer
 */

import type { PrimaryDeliveryAttachments } from '../../../src/domain/entities/message-attachments.js';
import { generateNativeTaskDeliveryOutput } from '../../native/task-delivery';
import {
  appendCliTaskDeliveryFooter,
  appendCliTaskSection,
} from '../../task-delivery/cli-task-section.js';
import { appendTaskDeliveryHandoffSections } from '../../task-delivery/core.js';

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

  /** Whether this role is the team entry point (planner/coordinator). Only entry points can create contexts. */
  isEntryPoint: boolean;

  /** Available handoff targets for this role (e.g. ['builder', 'planner', 'user']) */
  availableHandoffTargets: string[];

  /** When true, omit get-next-task language (native harness task injection). */
  nativeIntegration?: boolean;

  /** Attachments from the task SOURCE message (primary delivery kinds only). */
  sourceAttachments?: PrimaryDeliveryAttachments;
  /** Standing instructions for this chatroom (null = none active). */
  standingInstructions?: string | null;
  /** When true, entry-point task delivery includes handoff-enhancer guidance. */
  plannerEnhancerEnabled?: boolean;
}

// ─── Generator ────────────────────────────────────────────────────────────────

function buildNativeTaskDeliveryOutput(params: FullCliOutputParams): string {
  const {
    chatroomId,
    role,
    cliEnvPrefix,
    teamId,
    task,
    message,
    availableHandoffTargets,
    isEntryPoint,
    sourceAttachments,
    standingInstructions,
    plannerEnhancerEnabled,
  } = params;

  return generateNativeTaskDeliveryOutput({
    chatroomId,
    role,
    cliEnvPrefix,
    teamId,
    task,
    message: message ? { _id: message._id, senderRole: message.senderRole } : null,
    availableHandoffTargets,
    isEntryPoint,
    sourceAttachments,
    standingInstructions,
    plannerEnhancerEnabled,
  });
}

function appendCliSharedHandoffSections(
  lines: string[],
  params: Pick<
    FullCliOutputParams,
    | 'chatroomId'
    | 'role'
    | 'cliEnvPrefix'
    | 'teamId'
    | 'task'
    | 'message'
    | 'availableHandoffTargets'
    | 'isEntryPoint'
    | 'plannerEnhancerEnabled'
  >
): void {
  const { message, ...rest } = params;
  appendTaskDeliveryHandoffSections(lines, {
    ...rest,
    message: message ? { _id: message._id, senderRole: message.senderRole } : null,
  });
}

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
    isEntryPoint,
    availableHandoffTargets,
    nativeIntegration = false,
    sourceAttachments,
    standingInstructions,
    plannerEnhancerEnabled,
  } = params;

  if (nativeIntegration) {
    return buildNativeTaskDeliveryOutput(params);
  }

  const lines: string[] = [];
  appendCliTaskSection(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    isEntryPoint,
    task,
    message: message ? { _id: message._id, senderRole: message.senderRole } : null,
    sourceAttachments,
    standingInstructions,
  });

  appendCliSharedHandoffSections(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    teamId,
    task,
    message,
    availableHandoffTargets,
    isEntryPoint,
    plannerEnhancerEnabled,
  });
  appendCliTaskDeliveryFooter(lines, { chatroomId, role, cliEnvPrefix });

  return lines.join('\n');
}
