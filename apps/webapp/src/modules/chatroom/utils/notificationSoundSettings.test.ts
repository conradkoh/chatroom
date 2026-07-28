import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTIFICATION_SOUND_SETTINGS,
  getNotificationSoundSettings,
  setNotificationSoundSettings,
} from './notificationSoundSettings';

const STORAGE_KEY = 'chatroom:notification-sound-settings';
const LEGACY_MUTE_KEY = 'chatroom:notification-sound-muted';

describe('notificationSoundSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns defaults when nothing stored', () => {
    expect(getNotificationSoundSettings()).toEqual(DEFAULT_NOTIFICATION_SOUND_SETTINGS);
  });

  it('persists and retrieves settings', () => {
    setNotificationSoundSettings({ muted: true, profile: 'urgent', volume: 0.5 });
    const s = getNotificationSoundSettings();
    expect(s.muted).toBe(true);
    expect(s.profile).toBe('urgent');
    expect(s.volume).toBe(0.5);
  });

  it('merges partial update', () => {
    setNotificationSoundSettings({ profile: 'urgent' });
    const s = getNotificationSoundSettings();
    expect(s.profile).toBe('urgent');
    expect(s.muted).toBe(false);
    expect(s.volume).toBe(0.75);
  });

  it('clamps volume to 0..1', () => {
    setNotificationSoundSettings({ volume: -0.5 });
    expect(getNotificationSoundSettings().volume).toBe(0);
    setNotificationSoundSettings({ volume: 2 });
    expect(getNotificationSoundSettings().volume).toBe(1);
  });

  it('migrates legacy mute key', () => {
    localStorage.setItem(LEGACY_MUTE_KEY, 'true');
    const s = getNotificationSoundSettings();
    expect(s.muted).toBe(true);
    expect(s.profile).toBe('standard');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).muted).toBe(true);
  });

  it('ignores corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    expect(getNotificationSoundSettings()).toEqual(DEFAULT_NOTIFICATION_SOUND_SETTINGS);
  });

  it('handles invalid profile gracefully', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile: 'invalid' }));
    expect(getNotificationSoundSettings().profile).toBe('standard');
  });
});
