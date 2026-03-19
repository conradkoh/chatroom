'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogPortal } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
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
 *
 * Uses DialogPrimitive.Content directly (no ShadCN DialogContent wrapper) to:
 * - Avoid the default overlay backdrop (no fade-in lag)
 * - Open instantly (duration-0 on open, smooth fade on close)
 * - Apply the industrial theme cleanly without fighting Tailwind specificity
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPortal>
        {/* No overlay — cmd+k is a quick-picker, not a blocking modal. Avoids backdrop fade lag. */}
        <DialogPrimitive.Content
          forceMount
          className={cn(
            // Position: centered on screen
            'fixed top-[50%] left-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%]',
            // Industrial theme: sharp corners, 2px adaptive border, no shadow
            'rounded-none border-2 border-chatroom-border shadow-none',
            // Background
            'bg-chatroom-bg-primary overflow-hidden',
            // Animation: open instantly (duration-0), close with smooth fade+zoom-out
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=closed]:zoom-out-95',
            'data-[state=open]:duration-0 data-[state=closed]:duration-200'
          )}
        >
          {/* Accessible title and description (sr-only) */}
          <DialogPrimitive.Title className="sr-only">Switch Chatroom</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search and navigate to a chatroom
          </DialogPrimitive.Description>

          <Command>
            <CommandInput placeholder="Search chatrooms..." />
            <CommandList className="h-[300px]">
              <CommandEmpty className="text-muted-foreground text-xs font-bold uppercase tracking-wider">
                No chatrooms found.
              </CommandEmpty>
              {chatrooms && chatrooms.length > 0 && (
                <CommandGroup
                  heading="Chatrooms"
                  className="[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-[10px]"
                >
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
                        <Star
                          size={10}
                          className="text-yellow-500 flex-shrink-0"
                          fill="currentColor"
                        />
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
          </Command>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
