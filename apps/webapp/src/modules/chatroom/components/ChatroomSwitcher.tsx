'use client';

import type { Observable } from '@legendapp/state';
import { useSelector } from '@legendapp/state/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useCallback, useState, useRef, useMemo, useSyncExternalStore } from 'react';

import {
  acquireChatroomSwitcherPartition,
  beginChatroomSwitcherPreload,
  commitChatroomSwitcherPreload,
  getChatroomSwitcherPreloadChatrooms,
  releaseChatroomSwitcherPartition,
  type ChatroomSwitcherPartitionState,
} from './chatroomSwitcherPartitionStore';
import { buildChatroomSwitcherRows, getChatroomSwitcherKeywords } from './chatroomSwitcherRows';
import { ChatroomSwitcherVirtualizedList } from './ChatroomSwitcherVirtualizedList';
import { CommandDialogContent } from './shared/CommandDialogContent';

import { Command, CommandEmpty, CommandInput, CommandList } from '@/components/ui/command';
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useTwoFingerTap } from '@/hooks/useTwoFingerTap';
import { useChatroomListing } from '@/modules/chatroom/context/ChatroomListingContext';
import type { ChatroomWithStatus } from '@/modules/chatroom/context/ChatroomListingContext';
import { useCommandDialogActions } from '@/modules/chatroom/context/CommandDialogContext';
import {
  getChatroomSwitcherOpen,
  subscribeActiveContextManagedDialog,
} from '@/modules/chatroom/context/contextManagedDialogsController';
import { useCommandDialogShortcut } from '@/modules/chatroom/hooks/useCommandDialogShortcut';
import { useEscapeToClear } from '@/modules/chatroom/hooks/useEscapeToClear';
import { sortChatroomsWithCurrentFirst } from '@/modules/chatroom/utils/sortChatroomsWithCurrentFirst';

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
  const { openDialog, closeDialog } = useCommandDialogActions();
  const open = useSyncExternalStore(
    subscribeActiveContextManagedDialog,
    getChatroomSwitcherOpen,
    () => false
  );
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

    const runPreload = () => {
      for (const c of switcherChatrooms) {
        getChatroomSwitcherKeywords(c);
      }
      commitChatroomSwitcherPreload(state$, generation, switcherChatrooms);
    };

    // fallow-ignore-next-line code-duplication
    const idleId =
      typeof requestIdleCallback !== 'undefined'
        ? requestIdleCallback(runPreload, { timeout: 2000 })
        : setTimeout(runPreload, 0);

    return () => {
      if (typeof cancelIdleCallback !== 'undefined' && typeof idleId === 'number') {
        cancelIdleCallback(idleId);
      } else {
        clearTimeout(idleId as ReturnType<typeof setTimeout>);
      }
      releaseChatroomSwitcherPartition();
      setPartitionState$(null);
    };
  }, [switcherChatrooms]);

  const [searchValue, setSearchValue] = useState('');
  const searchValueRef = useRef(searchValue);
  searchValueRef.current = searchValue;
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

  const rows = useMemo(
    () => buildChatroomSwitcherRows(displayChatrooms ?? [], searchValue),
    [displayChatrooms, searchValue]
  );

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

        <Command shouldFilter={false} className="bg-chatroom-bg-primary text-chatroom-text-primary">
          <CommandInput
            placeholder="Search chatrooms..."
            className="text-chatroom-text-primary placeholder:text-chatroom-text-muted bg-transparent"
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList className="min-h-[244px] h-[244px] p-0 overflow-hidden">
            <CommandEmpty className="text-chatroom-text-muted text-xs font-bold uppercase tracking-wider px-4">
              No chatrooms found.
            </CommandEmpty>
            {rows.some((row) => row.type === 'item') && (
              <ChatroomSwitcherVirtualizedList
                rows={rows}
                onSelect={handleSelect}
                scrollResetKey={searchValue}
              />
            )}
          </CommandList>
        </Command>
      </CommandDialogContent>
    </Dialog>
  );
}
