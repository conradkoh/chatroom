const STORAGE_KEY = 'chatroom:notification-sound-muted';

export function isNotificationSoundMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return false;
    return JSON.parse(raw) === true;
  } catch {
    return false;
  }
}

export function setNotificationSoundMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(muted));
  } catch {
    // localStorage unavailable — silently ignore
  }
}
