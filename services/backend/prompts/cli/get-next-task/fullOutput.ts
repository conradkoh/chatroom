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
import {
  appendTaskDeliveryHandoffTargets,
  appendTaskDeliveryHandoffTemplates,
  appendTaskDeliveryNextSteps,
} from '../../task-delivery/core.js';

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

  /** Attachments from the task SOURCE message (primary delivery kinds only). */
  sourceAttachments?: PrimaryDeliveryAttachments;
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
    originMessage,
    availableHandoffTargets,
    isEntryPoint,
    sourceAttachments,
    currentContext,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
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
    currentContext,
    originMessage: originMessage ? { senderRole: originMessage.senderRole } : null,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
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
  >
): void {
  const {
    chatroomId,
    role,
    cliEnvPrefix,
    teamId,
    task,
    message,
    availableHandoffTargets,
    isEntryPoint,
  } = params;

  appendTaskDeliveryNextSteps(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    message: message ? { _id: message._id, senderRole: message.senderRole } : null,
    availableHandoffTargets,
    task,
    isEntryPoint,
  });
  appendTaskDeliveryHandoffTemplates(lines, { teamId, role, chatroomId, cliEnvPrefix });
  appendTaskDeliveryHandoffTargets(lines, {
    chatroomId,
    role,
    cliEnvPrefix,
    availableHandoffTargets,
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
    currentContext,
    originMessage,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
    isEntryPoint,
    availableHandoffTargets,
    nativeIntegration = false,
    sourceAttachments,
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
    currentContext,
    originMessage,
    followUpCountSinceOrigin,
    originMessageCreatedAt,
    sourceAttachments,
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
  });
  appendCliTaskDeliveryFooter(lines, { chatroomId, role, cliEnvPrefix });

  return lines.join('\n');
}
