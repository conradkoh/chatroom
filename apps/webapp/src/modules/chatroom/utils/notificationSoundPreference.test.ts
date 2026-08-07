import { beforeEach, describe, expect, it } from 'vitest';

import { isNotificationSoundMuted, setNotificationSoundMuted } from './notificationSoundPreference';

const SETTINGS_KEY = 'chatroom:notification-sound-settings';

describe('notificationSoundPreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to unmuted (false)', () => {
    expect(isNotificationSoundMuted()).toBe(false);
  });

  it('returns true after setting muted', () => {
    setNotificationSoundMuted(true);
    expect(isNotificationSoundMuted()).toBe(true);
  });

  it('returns false after setting unmuted', () => {
    setNotificationSoundMuted(true);
    setNotificationSoundMuted(false);
    expect(isNotificationSoundMuted()).toBe(false);
  });

  it('persists muted in settings object', () => {
    setNotificationSoundMuted(true);
    expect(isNotificationSoundMuted()).toBe(true);
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.muted).toBe(true);
  });

  it('falls back to false when settings have corrupt JSON', () => {
    localStorage.setItem(SETTINGS_KEY, 'not-json');
    expect(isNotificationSoundMuted()).toBe(false);
  });
});
