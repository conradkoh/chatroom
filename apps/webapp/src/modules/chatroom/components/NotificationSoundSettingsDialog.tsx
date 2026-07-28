'use client';

import { Loader2 } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

import {
  DEFAULT_NOTIFICATION_SOUND_SETTINGS,
  NOTIFICATION_SOUND_PROFILE_OPTIONS,
  type NotificationSoundProfile,
  getNotificationSoundSettings,
  setNotificationSoundSettings,
} from '../utils/notificationSoundSettings';
import { playNotificationSound } from '../utils/playNotificationSound';

export interface NotificationSoundSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DIALOG_BODY_MIN_HEIGHT_CLASS = 'min-h-[260px]';

export function NotificationSoundSettingsDialog({
  open,
  onOpenChange,
}: NotificationSoundSettingsDialogProps) {
  const [profile, setProfile] = useState<NotificationSoundProfile>(
    DEFAULT_NOTIFICATION_SOUND_SETTINGS.profile
  );
  const [volume, setVolume] = useState(DEFAULT_NOTIFICATION_SOUND_SETTINGS.volume);
  const [isHydrated, setIsHydrated] = useState(false);

  useLayoutEffect(() => {
    if (!open) {
      setIsHydrated(false);
      return;
    }
    const s = getNotificationSoundSettings();
    setProfile(s.profile);
    setVolume(s.volume);
    setIsHydrated(true);
  }, [open]);

  const persistProfile = (next: NotificationSoundProfile) => {
    setProfile(next);
    setNotificationSoundSettings({ profile: next });
  };

  const persistVolume = (pct: number) => {
    const v = pct / 100;
    setVolume(v);
    setNotificationSoundSettings({ volume: v });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        floating
        className="sm:max-w-md"
        data-testid="notification-sound-settings-dialog"
      >
        <DialogHeader>
          <DialogTitle>Notification sound</DialogTitle>
          <DialogDescription>
            Choose how loudly you&apos;re notified when an agent hands off to you.
          </DialogDescription>
        </DialogHeader>

        {!isHydrated ? (
          <div
            className={`flex flex-col items-center justify-center gap-2 py-2 ${DIALOG_BODY_MIN_HEIGHT_CLASS}`}
            data-testid="notification-sound-settings-loading"
            aria-busy="true"
            aria-live="polite"
          >
            <Loader2 className="h-5 w-5 animate-spin text-chatroom-text-muted" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
              Loading settings...
            </span>
          </div>
        ) : (
          <div className={`flex flex-col gap-4 py-2 ${DIALOG_BODY_MIN_HEIGHT_CLASS}`}>
            {/* Profile radios */}
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-chatroom-text-primary mb-1">
                Sound profile
              </legend>
              {NOTIFICATION_SOUND_PROFILE_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className="flex items-start gap-3 cursor-pointer"
                  data-testid={`notification-sound-profile-${opt.id}`}
                >
                  <input
                    type="radio"
                    name="notification-sound-profile"
                    value={opt.id}
                    checked={profile === opt.id}
                    onChange={() => persistProfile(opt.id)}
                    className="mt-1 accent-chatroom-status-info"
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-chatroom-text-primary">
                      {opt.label}
                    </span>
                    <span className="text-xs text-chatroom-text-muted">{opt.description}</span>
                  </div>
                </label>
              ))}
            </fieldset>

            {/* Volume */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor="notification-sound-volume"
                className="text-sm font-medium text-chatroom-text-primary"
              >
                Volume: {Math.round(volume * 100)}%
              </label>
              <input
                id="notification-sound-volume"
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(volume * 100)}
                onChange={(e) => persistVolume(Number(e.target.value))}
                className="w-full accent-chatroom-status-info"
                data-testid="notification-sound-volume-slider"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            disabled={!isHydrated}
            onClick={() => playNotificationSound({ force: true, preview: { profile, volume } })}
            data-testid="notification-sound-settings-play-test"
            className="px-4 py-2 text-sm font-medium rounded-none border-2 border-chatroom-border-strong text-chatroom-text-primary bg-chatroom-bg-secondary hover:bg-chatroom-bg-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Play test sound
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
