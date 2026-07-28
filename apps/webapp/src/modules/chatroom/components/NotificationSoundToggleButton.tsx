'use client';

import { Volume2, VolumeX } from 'lucide-react';

import { usePersistedState } from '../hooks/usePersistedState';
import { setNotificationSoundMuted } from '../utils/notificationSoundPreference';

const headerIconButtonClassName =
  'bg-transparent text-chatroom-text-secondary w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary outline-none focus:outline-none focus-visible:outline-none';

const STORAGE_KEY = 'chatroom:notification-sound-muted';

export function NotificationSoundToggleButton() {
  const [muted, setMuted] = usePersistedState(STORAGE_KEY, false, {
    validate: (v): v is boolean => typeof v === 'boolean',
  });

  const toggle = () => {
    const next = !muted;
    setMuted(next);
    setNotificationSoundMuted(next);
  };

  return (
    <button
      type="button"
      className={headerIconButtonClassName}
      title={muted ? 'Unmute notification sound' : 'Mute notification sound'}
      aria-label={muted ? 'Unmute notification sound' : 'Mute notification sound'}
      aria-pressed={muted}
      onClick={toggle}
    >
      {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
    </button>
  );
}
