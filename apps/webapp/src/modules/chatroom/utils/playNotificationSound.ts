import type { NotificationSoundProfile } from './notificationSoundSettings';
import { getNotificationSoundSettings } from './notificationSoundSettings';
import { synthesizeNotificationSound } from './synthesizeNotificationSound';

export interface PlayNotificationSoundOptions {
  /** When true, plays even if the user has muted notification sounds (e.g. test preview). */
  force?: boolean;
  /** Override profile/volume for preview (e.g. while user is editing in dialog). */
  preview?: { profile: NotificationSoundProfile; volume: number };
}

export function playNotificationSound(options?: PlayNotificationSoundOptions): void {
  if (typeof window === 'undefined') return;
  const settings = getNotificationSoundSettings();
  if (!options?.force && settings.muted) return;

  const profile = options?.preview?.profile ?? settings.profile;
  const volume = options?.preview?.volume ?? settings.volume;
  if (volume <= 0) return;

  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    const ctx = new AudioContextCtor();
    synthesizeNotificationSound(ctx, profile, volume);
  } catch {
    // Audio unavailable in this environment
  }
}
