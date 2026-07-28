'use client';

import { Volume2, VolumeX } from 'lucide-react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

import { usePersistedState } from '../hooks/usePersistedState';
import { setNotificationSoundMuted } from '../utils/notificationSoundPreference';
import { playNotificationSound } from '../utils/playNotificationSound';

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
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className={headerIconButtonClassName}
          title={muted ? 'Unmute notification sound' : 'Mute notification sound'}
          aria-label={muted ? 'Unmute notification sound' : 'Mute notification sound'}
          aria-pressed={muted}
          onClick={toggle}
          data-testid="notification-sound-toggle"
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[160px] rounded-none">
        <ContextMenuItem
          className="rounded-none"
          onSelect={() => playNotificationSound({ force: true })}
          data-testid="notification-sound-play-test"
        >
          Play test sound
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
