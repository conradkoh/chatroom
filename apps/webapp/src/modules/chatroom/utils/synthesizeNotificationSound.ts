import type { NotificationSoundProfile } from './notificationSoundSettings';

export interface OscillatorSchedule {
  frequency: number;
  startTime: number;
  duration: number;
  type: OscillatorType;
  peakGain: number;
}

export function getNotificationSoundSchedules(
  profile: NotificationSoundProfile,
  volume: number
): OscillatorSchedule[] {
  const v = Math.min(1, Math.max(0, volume));
  switch (profile) {
    case 'subtle':
      return [{ frequency: 440, startTime: 0, duration: 0.18, type: 'sine', peakGain: v * 0.35 }];
    case 'standard':
      return [{ frequency: 880, startTime: 0, duration: 0.25, type: 'sine', peakGain: v * 0.33 }];
    case 'urgent':
      return [
        { frequency: 587, startTime: 0, duration: 0.12, type: 'sine', peakGain: v * 0.45 },
        { frequency: 880, startTime: 0.14, duration: 0.18, type: 'sine', peakGain: v * 0.55 },
      ];
  }
}

export function synthesizeNotificationSound(
  ctx: AudioContext,
  profile: NotificationSoundProfile,
  volume: number
): void {
  const schedules = getNotificationSoundSchedules(profile, volume);
  if (schedules.length === 0 || volume <= 0) return;

  let remaining = schedules.length;
  const onDone = () => {
    remaining -= 1;
    if (remaining <= 0) void ctx.close();
  };

  for (const s of schedules) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = s.type;
    osc.frequency.value = s.frequency;
    const t0 = ctx.currentTime + s.startTime;
    gain.gain.setValueAtTime(s.peakGain, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + s.duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + s.duration);
    osc.onended = onDone;
  }
}
