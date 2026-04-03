'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useCallback } from 'react';

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
import { fuzzyFilter } from '@/lib/fuzzyMatch';
import { COMMAND_DIALOG_CONTENT_CLASSES } from './shared/commandDialogStyles';
import { useCommandDialog } from '@/modules/chatroom/context/CommandDialogContext';
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
  const { activeDialog, openDialog, closeDialog } = useCommandDialog();
  const open = activeDialog === 'switcher';
  const setOpen = useCallback(
    (val: boolean) => (val ? openDialog('switcher') : closeDialog()),
    [openDialog, closeDialog]
  );
  const router = useRouter();
  const { chatrooms } = useChatroomListing();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const triggerKey = isMac ? e.metaKey : e.ctrlKey;

      if (triggerKey && e.key === 'k') {
        e.preventDefault();
        if (open) {
          closeDialog();
        } else {
          openDialog('switcher');
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, openDialog, closeDialog]);

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
          className={cn(...COMMAND_DIALOG_CONTENT_CLASSES)}
        >
          {/* Accessible title and description (sr-only) */}
          <DialogPrimitive.Title className="sr-only">Switch Chatroom</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search and navigate to a chatroom
          </DialogPrimitive.Description>

          <Command filter={fuzzyFilter} className="bg-chatroom-bg-primary text-chatroom-text-primary">
            <CommandInput
              placeholder="Search chatrooms..."
              className="text-chatroom-text-primary placeholder:text-chatroom-text-muted bg-transparent"
            />
            <CommandList className="min-h-[300px] h-[300px]">
              <CommandEmpty className="text-chatroom-text-muted text-xs font-bold uppercase tracking-wider px-4">
                No chatrooms found.
              </CommandEmpty>
              {chatrooms && chatrooms.length > 0 && (
                <CommandGroup
                  heading="Chatrooms"
                  className="[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-chatroom-text-muted"
                >
                  {chatrooms.map((chatroom) => (
                    <CommandItem
                      key={chatroom._id}
                      value={getChatroomDisplayName(chatroom)}
                      onSelect={() => handleSelect(chatroom._id)}
                      className="flex flex-row items-center gap-2 rounded-none text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover data-[selected=true]:text-chatroom-text-primary"
                    >
                      {/* Status indicator dot */}
                      <span className={getStatusIndicatorClasses(chatroom.chatStatus)} />

                      {/* Chatroom name */}
                      <span className="text-xs font-bold uppercase tracking-wide text-chatroom-text-primary flex-1 truncate">
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
