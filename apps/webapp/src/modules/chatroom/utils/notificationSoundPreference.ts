import {
  getNotificationSoundSettings,
  setNotificationSoundSettings,
} from './notificationSoundSettings';

export function isNotificationSoundMuted(): boolean {
  return getNotificationSoundSettings().muted;
}

export function setNotificationSoundMuted(muted: boolean): void {
  setNotificationSoundSettings({ muted });
}
