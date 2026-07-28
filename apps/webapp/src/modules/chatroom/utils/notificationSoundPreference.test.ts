import { describe, expect, it } from 'vitest';

import { isNotificationSoundMuted, setNotificationSoundMuted } from './notificationSoundPreference';

const STORAGE_KEY = 'chatroom:notification-sound-muted';

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

  it('persists value across calls', () => {
    setNotificationSoundMuted(true);
    expect(isNotificationSoundMuted()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('falls back to false when localStorage has corrupt data', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    expect(isNotificationSoundMuted()).toBe(false);
  });
});
