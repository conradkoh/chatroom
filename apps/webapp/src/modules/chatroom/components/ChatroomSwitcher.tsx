'use client';

import type { Observable } from '@legendapp/state';
import { useSelector } from '@legendapp/state/react';
import { Star } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useCallback, useState, useRef, useMemo } from 'react';

import {
  acquireChatroomSwitcherPartition,
  beginChatroomSwitcherPreload,
  commitChatroomSwitcherPreload,
  getChatroomSwitcherPreloadChatrooms,
  releaseChatroomSwitcherPartition,
  type ChatroomSwitcherPartitionState,
} from './chatroomSwitcherPartitionStore';
import { CommandDialogContent } from './shared/CommandDialogContent';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useTwoFingerTap } from '@/hooks/useTwoFingerTap';
import { fuzzyFilter } from '@/lib/fuzzyMatch';
import { useChatroomListing } from '@/modules/chatroom/context/ChatroomListingContext';
import type { ChatroomWithStatus } from '@/modules/chatroom/context/ChatroomListingContext';
import { useCommandDialog } from '@/modules/chatroom/context/CommandDialogContext';
import { useCommandDialogShortcut } from '@/modules/chatroom/hooks/useCommandDialogShortcut';
import { useCommandListScrollReset } from '@/modules/chatroom/hooks/useCommandListScrollReset';
import { useEscapeToClear } from '@/modules/chatroom/hooks/useEscapeToClear';
import { getChatStatusIndicatorClasses } from '@/modules/chatroom/utils/chatStatusDisplay';
import { sortChatroomsWithCurrentFirst } from '@/modules/chatroom/utils/sortChatroomsWithCurrentFirst';
import { getChatroomDisplayName } from '@/modules/chatroom/viewModels/chatroomViewModel';

function getChatroomSwitcherKeywords(
  chatroom: Pick<ChatroomWithStatus, 'name' | 'teamName'>
): string[] {
  const displayName = getChatroomDisplayName(chatroom);
  if (chatroom.teamName && chatroom.teamName !== displayName) {
    return [displayName, chatroom.teamName];
  }
  return [displayName];
}

// Status indicator uses shared chatStatusDisplay (mirrors ChatroomSidebar + listing page)

function ChatroomSwitcherItem({
  chatroom,
  onSelect,
}: {
  chatroom: ChatroomWithStatus;
  onSelect: (chatroomId: string) => void;
}) {
  const displayName = getChatroomDisplayName(chatroom);

  return (
    <CommandItem
      value={chatroom._id}
      keywords={getChatroomSwitcherKeywords(chatroom)}
      onSelect={() => onSelect(chatroom._id)}
      className="flex flex-row items-center gap-2 rounded-none cursor-pointer text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover data-[selected=true]:text-chatroom-text-primary"
    >
      <span className={getChatStatusIndicatorClasses(chatroom.chatStatus)} />
      <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary flex-1 truncate">
        {displayName}
      </span>
      {chatroom.isFavorite && (
        <Star size={10} className="text-yellow-500 flex-shrink-0" fill="currentColor" />
      )}
      {chatroom.hasUnread && <span className="w-1.5 h-1.5 bg-chatroom-accent flex-shrink-0" />}
    </CommandItem>
  );
}

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

  // Two-finger tap on mobile opens/closes the chatroom switcher
  const toggleOpen = useCallback(
    () => (open ? closeDialog() : openDialog('switcher')),
    [open, openDialog, closeDialog]
  );
  useTwoFingerTap(toggleOpen);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeChatroomId = pathname === '/app/chatroom' ? searchParams.get('id') : null;
  const { chatrooms } = useChatroomListing();
  const switcherChatrooms = useMemo(() => {
    if (!chatrooms) return undefined;
    const activeChatrooms = chatrooms.filter((chatroom) => chatroom.chatStatus !== 'completed');
    return sortChatroomsWithCurrentFirst(activeChatrooms, activeChatroomId);
  }, [chatrooms, activeChatroomId]);

  const [partitionState$, setPartitionState$] =
    useState<Observable<ChatroomSwitcherPartitionState> | null>(null);

  useEffect(() => {
    if (!switcherChatrooms || switcherChatrooms.length === 0) return;

    const state$ = acquireChatroomSwitcherPartition();
    setPartitionState$(state$);
    const generation = beginChatroomSwitcherPreload(state$);

    for (const c of switcherChatrooms) {
      getChatroomSwitcherKeywords(c);
    }
    commitChatroomSwitcherPreload(state$, generation, switcherChatrooms);

    return () => {
      releaseChatroomSwitcherPartition();
      setPartitionState$(null);
    };
  }, [switcherChatrooms]);

  const [searchValue, setSearchValue] = useState('');
  const searchValueRef = useRef(searchValue);
  searchValueRef.current = searchValue;
  const listRef = useCommandListScrollReset(searchValue);
  const onEscapeKeyDown = useEscapeToClear(searchValueRef, () => setSearchValue(''));

  const isSearching = searchValue.trim().length > 0;

  const { preloadedChatrooms, partitionStatus } = useSelector(() => {
    if (!partitionState$) {
      return { preloadedChatrooms: [] as ChatroomWithStatus[], partitionStatus: 'idle' as const };
    }
    const status = partitionState$.status.get();
    const partitionKey = partitionState$.partitionKey.get();
    return {
      partitionStatus: status,
      preloadedChatrooms:
        status === 'ready' ? getChatroomSwitcherPreloadChatrooms(partitionKey) : [],
    };
  });

  const displayChatrooms = useMemo(() => {
    if (!isSearching && partitionStatus === 'ready' && preloadedChatrooms.length > 0) {
      return preloadedChatrooms;
    }
    return switcherChatrooms;
  }, [isSearching, partitionStatus, preloadedChatrooms, switcherChatrooms]);

  // Reset search when closing
  useEffect(() => {
    if (!open) setSearchValue('');
  }, [open]);

  useCommandDialogShortcut({ dialog: 'switcher', key: 'k' });

  const handleSelect = (chatroomId: string) => {
    if (activeChatroomId !== chatroomId) {
      router.push(`/app/chatroom?id=${chatroomId}`);
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      {/* No overlay — cmd+k is a quick-picker, not a blocking modal. Avoids backdrop fade lag. */}
      <CommandDialogContent
        open={open}
        onEscapeKeyDown={onEscapeKeyDown}
        onBackdropDismiss={() => setOpen(false)}
      >
        {/* Accessible title and description (sr-only) */}
        <DialogTitle className="sr-only">Switch Chatroom</DialogTitle>
        <DialogDescription className="sr-only">Search and navigate to a chatroom</DialogDescription>

        <Command filter={fuzzyFilter} className="bg-chatroom-bg-primary text-chatroom-text-primary">
          <CommandInput
            placeholder="Search chatrooms..."
            className="text-chatroom-text-primary placeholder:text-chatroom-text-muted bg-transparent"
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <div ref={listRef} className="overflow-y-auto min-h-[244px] h-[244px]">
            <CommandList className="min-h-full max-h-none overflow-hidden p-0">
              <CommandEmpty className="text-chatroom-text-muted text-xs font-bold uppercase tracking-wider px-4">
                No chatrooms found.
              </CommandEmpty>
              {displayChatrooms && displayChatrooms.length > 0 && (
                <CommandGroup
                  heading="Chatrooms"
                  className="[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-chatroom-text-muted"
                >
                  {displayChatrooms.map((chatroom) => (
                    <ChatroomSwitcherItem
                      key={chatroom._id}
                      chatroom={chatroom}
                      onSelect={handleSelect}
                    />
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </div>
        </Command>
      </CommandDialogContent>
    </Dialog>
  );
}
