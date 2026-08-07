'use client';

import { Volume2, VolumeX } from 'lucide-react';
import { useEffect, useState } from 'react';

import { NotificationSoundSettingsDialog } from './NotificationSoundSettingsDialog';
import {
  getNotificationSoundSettings,
  setNotificationSoundSettings,
} from '../utils/notificationSoundSettings';
import { playNotificationSound } from '../utils/playNotificationSound';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

const headerIconButtonClassName =
  'bg-transparent text-chatroom-text-secondary w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary outline-none focus:outline-none focus-visible:outline-none';

export function NotificationSoundToggleButton() {
  const [muted, setMutedState] = useState(() => getNotificationSoundSettings().muted);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!settingsOpen) {
      setMutedState(getNotificationSoundSettings().muted);
    }
  }, [settingsOpen]);

  const toggle = () => {
    const next = !muted;
    setMutedState(next);
    setNotificationSoundSettings({ muted: next });
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <button
              type="button"
              className={headerIconButtonClassName}
              title={muted ? 'Unmute notification sound' : 'Mute notification sound'}
              aria-label={muted ? 'Unmute notification sound' : 'Mute notification sound'}
              aria-pressed={muted}
              onClick={toggle}
              data-testid="notification-sound-toggle"
            />
          }
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[160px] rounded-none">
          <ContextMenuItem
            className="rounded-none"
            onSelect={() => playNotificationSound({ force: true })}
            data-testid="notification-sound-play-test"
          >
            Play test sound
          </ContextMenuItem>
          <ContextMenuItem
            className="rounded-none"
            onSelect={() => setSettingsOpen(true)}
            data-testid="notification-sound-open-settings"
          >
            Sound settings&hellip;
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <NotificationSoundSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
