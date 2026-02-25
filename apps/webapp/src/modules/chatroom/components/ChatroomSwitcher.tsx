'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Star } from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  useChatroomListing,
  type ChatroomWithStatus,
} from '@/modules/chatroom/context/ChatroomListingContext';
import { getChatroomDisplayName } from '@/modules/chatroom/viewModels/chatroomViewModel';

// Status indicator colors - using squares per theme guidelines (mirrors ChatroomSidebar)
const getStatusIndicatorClasses = (chatStatus: ChatroomWithStatus['chatStatus']) => {
  const base = 'w-1.5 h-1.5 flex-shrink-0';
  switch (chatStatus) {
    case 'working':
      return `${base} bg-chatroom-status-info`;
    case 'active':
      return `${base} bg-chatroom-status-success`;
    case 'idle':
    case 'completed':
    default:
      return `${base} bg-chatroom-text-muted opacity-40`;
  }
};

/**
 * Global Cmd+K chatroom switcher.
 *
 * Opens a command-palette style dialog that allows the user to fuzzy-search
 * and navigate to any chatroom. Triggered by Cmd+K (Mac) or Ctrl+K (Win/Linux).
 * Mount this once inside the authenticated app layout.
 */
export function ChatroomSwitcher() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { chatrooms } = useChatroomListing();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const triggerKey = isMac ? e.metaKey : e.ctrlKey;

      if (triggerKey && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSelect = (chatroomId: string) => {
    router.push(`/app/chatroom?id=${chatroomId}`);
    setOpen(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Switch Chatroom"
      description="Search and navigate to a chatroom"
    >
      <CommandInput placeholder="Search chatrooms..." />
      <CommandList>
        <CommandEmpty className="text-muted-foreground">No chatrooms found.</CommandEmpty>
        {chatrooms && chatrooms.length > 0 && (
          <CommandGroup heading="Chatrooms">
            {chatrooms.map((chatroom) => (
              <CommandItem
                key={chatroom._id}
                value={getChatroomDisplayName(chatroom)}
                onSelect={() => handleSelect(chatroom._id)}
                className="flex flex-row items-center gap-2 rounded-none hover:bg-accent/50 data-[selected=true]:bg-accent/50"
              >
                {/* Status indicator dot */}
                <span className={getStatusIndicatorClasses(chatroom.chatStatus)} />

                {/* Chatroom name */}
                <span className="text-xs font-bold uppercase tracking-wide text-foreground flex-1 truncate">
                  {getChatroomDisplayName(chatroom)}
                </span>

                {/* Favourite star */}
                {chatroom.isFavorite && (
                  <Star size={10} className="text-yellow-500 flex-shrink-0" fill="currentColor" />
                )}

                {/* Unread dot */}
                {chatroom.hasUnread && (
                  <span className="w-1.5 h-1.5 bg-chatroom-accent flex-shrink-0" />
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
