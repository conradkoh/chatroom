'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useChatroomListing } from '@/modules/chatroom/context/ChatroomListingContext';
import { getChatroomDisplayName } from '@/modules/chatroom/viewModels/chatroomViewModel';

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
                className="flex flex-col items-start gap-0.5"
              >
                <span className="text-xs font-bold uppercase tracking-wide text-foreground">
                  {getChatroomDisplayName(chatroom)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
