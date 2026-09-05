import { normalizeTaskEnvelope, type TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';

import { roleSupportsSessionAugmentation } from '../entities/team-agent-settings';

export type SessionAugmentationMode = 'none' | 'new_session';
export interface TaskSessionAugmentationInput {
  content: string;
  taskEnvelope?: TaskEnvelopeV1 | undefined;
  startInNewSession: boolean | undefined;
}
// Deliberate sequential precedence: explicit envelope, then legacy scalar, then
// role default. Each branch is a short, independently testable decision.
// fallow-ignore-next-line complexity
export function resolveSessionAugmentationForTask(
  task: TaskSessionAugmentationInput,
  role: string
): SessionAugmentationMode {
  // An explicit envelope is the immutable request policy and wins over every
  // legacy scalar. A malformed explicit envelope is never silently coerced.
  if (task.taskEnvelope !== undefined) {
    const envelope = normalizeTaskEnvelope({ taskEnvelope: task.taskEnvelope });
    return envelope.sessionPolicy === 'new' ? 'new_session' : 'none';
  }
  if (task.startInNewSession !== undefined) {
    return task.startInNewSession ? 'new_session' : 'none';
  }
  return resolveSessionAugmentationForRole(role);
}

/**
 * Direct native cold-restart intent. Explicit envelope policy wins over the
 * legacy scalar; an absent envelope preserves the old scalar-only behavior.
 */
export function taskRequestsNativeColdSession(task: TaskSessionAugmentationInput): boolean {
  if (task.taskEnvelope !== undefined) {
    return normalizeTaskEnvelope({ taskEnvelope: task.taskEnvelope }).sessionPolicy === 'new';
  }
  return task.startInNewSession === true;
}

export function shouldEmitSessionAugmentation(
  role: string,
  mode: SessionAugmentationMode
): boolean {
  return roleSupportsSessionAugmentation(role) || mode === 'new_session';
}

function resolveSessionAugmentationForRole(role: string): SessionAugmentationMode {
  if (!roleSupportsSessionAugmentation(role)) return 'none';
  return 'new_session';
}

export function sessionAugmentationToWantResume(mode: SessionAugmentationMode): boolean {
  return mode === 'none';
}

export function sessionAugmentationNewSessionStarted(mode: SessionAugmentationMode): boolean {
  return mode === 'new_session';
}
