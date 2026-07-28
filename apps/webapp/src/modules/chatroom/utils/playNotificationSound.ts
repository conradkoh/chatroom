import { isNotificationSoundMuted } from './notificationSoundPreference';

export function playNotificationSound(): void {
  if (typeof window === 'undefined') return;
  if (isNotificationSoundMuted()) return;

  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    const ctx = new AudioContextCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.25);
    oscillator.onended = () => {
      void ctx.close();
    };
  } catch {
    // Audio unavailable in this environment
  }
}
