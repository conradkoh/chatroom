import { roleSupportsSessionAugmentation } from '../entities/team-agent-settings';

export type SessionAugmentationMode = 'none' | 'new_session';
export interface TaskSessionAugmentationInput { content: string; startInNewSession: boolean | undefined; }
export function resolveSessionAugmentationForTask(task: TaskSessionAugmentationInput, role: string): SessionAugmentationMode {
  if (task.startInNewSession !== undefined) return task.startInNewSession ? 'new_session' : 'none';
  return resolveSessionAugmentationForRole(task.content, role);
}
export function shouldEmitSessionAugmentation(role: string, mode: SessionAugmentationMode): boolean {
  return roleSupportsSessionAugmentation(role) || mode === 'new_session';
}

export function resolveSessionAugmentationForRole(
  _handoffContent: string,
  role: string
): SessionAugmentationMode {
  if (!roleSupportsSessionAugmentation(role)) return 'none';
  return 'new_session';
}

export function sessionAugmentationToWantResume(mode: SessionAugmentationMode): boolean {
  return mode === 'none';
}

export function sessionAugmentationNewSessionStarted(mode: SessionAugmentationMode): boolean {
  return mode === 'new_session';
}
