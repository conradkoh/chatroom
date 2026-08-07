const STORAGE_KEY = 'chatroom:notification-sound-settings';
const LEGACY_MUTE_KEY = 'chatroom:notification-sound-muted';

export type NotificationSoundProfile = 'subtle' | 'standard' | 'urgent' | 'bright' | 'alarm';

export interface NotificationSoundSettings {
  muted: boolean;
  profile: NotificationSoundProfile;
  /** 0..1 */
  volume: number;
}

export const DEFAULT_NOTIFICATION_SOUND_SETTINGS: NotificationSoundSettings = {
  muted: false,
  profile: 'standard',
  volume: 0.75,
};

export const NOTIFICATION_SOUND_PROFILE_OPTIONS: {
  id: NotificationSoundProfile;
  label: string;
  description: string;
}[] = [
  { id: 'subtle', label: 'Subtle', description: 'Soft single tone — minimal interruption' },
  { id: 'standard', label: 'Standard', description: 'Balanced chime — everyday attention' },
  { id: 'urgent', label: 'Urgent', description: 'Double ascending tone — high attention' },
  { id: 'bright', label: 'Bright', description: 'Triple ascending chime — clear and lively' },
  { id: 'alarm', label: 'Alarm', description: 'Pulsing alert — maximum attention' },
];

const PROFILES: NotificationSoundProfile[] = ['subtle', 'standard', 'urgent', 'bright', 'alarm'];

function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_NOTIFICATION_SOUND_SETTINGS.volume;
  return Math.min(1, Math.max(0, v));
}

function parseSettings(raw: string | null): NotificationSoundSettings {
  if (raw === null) return { ...DEFAULT_NOTIFICATION_SOUND_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<NotificationSoundSettings>;
    return {
      muted: parsed.muted === true,
      profile: PROFILES.includes(parsed.profile as NotificationSoundProfile)
        ? (parsed.profile as NotificationSoundProfile)
        : DEFAULT_NOTIFICATION_SOUND_SETTINGS.profile,
      volume: clampVolume(parsed.volume ?? DEFAULT_NOTIFICATION_SOUND_SETTINGS.volume),
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_SOUND_SETTINGS };
  }
}

export function getNotificationSoundSettings(): NotificationSoundSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_NOTIFICATION_SOUND_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return parseSettings(raw);

    const legacy = localStorage.getItem(LEGACY_MUTE_KEY);
    if (legacy !== null) {
      const muted = JSON.parse(legacy) === true;
      const migrated = { ...DEFAULT_NOTIFICATION_SOUND_SETTINGS, muted };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return { ...DEFAULT_NOTIFICATION_SOUND_SETTINGS };
  } catch {
    return { ...DEFAULT_NOTIFICATION_SOUND_SETTINGS };
  }
}

export function setNotificationSoundSettings(
  patch: Partial<NotificationSoundSettings>
): NotificationSoundSettings {
  const current = getNotificationSoundSettings();
  const next = {
    ...current,
    ...patch,
    volume: patch.volume !== undefined ? clampVolume(patch.volume) : current.volume,
  };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}
