import { roleSupportsSessionAugmentation } from '../entities/team-agent-settings';

export type SessionAugmentationMode = 'none' | 'new_session';

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
