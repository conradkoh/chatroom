'use client';

import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useChatroomListing, type ChatroomWithStatus } from '../context/ChatroomListingContext';
import { getChatroomDisplayName } from '../viewModels/chatroomViewModel';
import { Search, X } from 'lucide-react';

// ─── Status Indicator ─────────────────────────────────────────────────────────

/** Status indicator dot - matches theme colors */
function StatusIndicator({ chatStatus }: { chatStatus: ChatroomWithStatus['chatStatus'] }) {
  const base = 'w-1.5 h-1.5 flex-shrink-0';
  switch (chatStatus) {
    case 'working':
      return <span className={`${base} bg-chatroom-status-info`} />;
    case 'active':
      return <span className={`${base} bg-chatroom-status-success`} />;
    case 'idle':
    case 'completed':
    default:
      return <span className={`${base} bg-chatroom-text-muted opacity-40`} />;
  }
}

// ─── Chatroom Switcher Sheet ──────────────────────────────────────────────────

interface ChatroomSwitcherSheetProps {
  /** Whether the sheet is open */
  open: boolean;
  /** Called when the sheet should close */
  onOpenChange: (open: boolean) => void;
  /** Current chatroom ID to show as active */
  currentChatroomId?: string;
}

/**
 * Mobile chatroom switcher sheet.
 *
 * Opens as a left-side sheet on mobile, showing a compact list of chatrooms.
 * Users can tap to switch between chatrooms.
 *
 * Usage:
 * ```tsx
 * <ChatroomSwitcherSheet
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   currentChatroomId={chatroomId}
 * />
 * ```
 */
export function ChatroomSwitcherSheet({
  open,
  onOpenChange,
  currentChatroomId,
}: ChatroomSwitcherSheetProps) {
  const router = useRouter();
  const { chatrooms, isLoading } = useChatroomListing();

  const [searchValue, setSearchValue] = useState('');

  // Reset search when sheet closes
  useEffect(() => {
    if (!open) {
      setSearchValue('');
    }
  }, [open]);

  // Filter chatrooms based on search
  const filteredChatrooms = useMemo(() => {
    if (!chatrooms) return [];
    if (!searchValue.trim()) return chatrooms;
    const lower = searchValue.toLowerCase().trim();
    return chatrooms.filter((c) => {
      const name = getChatroomDisplayName(c).toLowerCase();
      const id = c._id.toLowerCase();
      return name.includes(lower) || id.includes(lower);
    });
  }, [chatrooms, searchValue]);

  const handleSelect = useCallback(
    (chatroomId: string) => {
      router.push(`/app/chatroom?id=${chatroomId}`);
      onOpenChange(false);
    },
    [router, onOpenChange]
  );

  const handleClearSearch = useCallback(() => {
    setSearchValue('');
  }, []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-[85vw] sm:max-w-sm bg-chatroom-bg-primary border-chatroom-border p-0"
      >
        <SheetHeader className="p-4 border-b border-chatroom-border">
          <SheetTitle className="text-chatroom-text-primary text-xs font-bold uppercase tracking-widest">
            Switch Chatroom
          </SheetTitle>

          {/* Search Input */}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-chatroom-text-muted"
            />
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search chatrooms..."
              className="w-full bg-chatroom-bg-surface border-2 border-chatroom-border text-chatroom-text-primary pl-9 pr-9 py-2 text-xs font-mono placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent transition-colors"
              autoFocus
            />
            {searchValue && (
              <button
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </SheetHeader>

        {/* Chatroom List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
            </div>
          ) : filteredChatrooms.length === 0 ? (
            <div className="text-center py-12 text-chatroom-text-muted text-xs font-bold uppercase tracking-wider">
              No chatrooms found
            </div>
          ) : (
            <div className="py-2">
              {filteredChatrooms.map((chatroom) => {
                const isActive = chatroom._id === currentChatroomId;
                const displayName = getChatroomDisplayName(chatroom);

                return (
                  <button
                    key={chatroom._id}
                    onClick={() => handleSelect(chatroom._id)}
                    className={`
                      w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-100
                      ${
                        isActive
                          ? 'bg-chatroom-accent/10 text-chatroom-text-primary'
                          : 'text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary'
                      }
                    `}
                  >
                    {/* Status indicator */}
                    <StatusIndicator chatStatus={chatroom.chatStatus} />

                    {/* Chatroom name */}
                    <span
                      className={`
                        flex-1 text-xs font-bold uppercase tracking-wide truncate
                        ${isActive ? 'text-chatroom-accent' : ''}
                      `}
                    >
                      {displayName}
                    </span>

                    {/* Favorite indicator */}
                    {chatroom.isFavorite && (
                      <Star
                        size={10}
                        className="text-yellow-500 flex-shrink-0"
                        fill="currentColor"
                      />
                    )}

                    {/* Unread indicator */}
                    {chatroom.hasUnread && !isActive && (
                      <span className="w-1.5 h-1.5 bg-chatroom-accent flex-shrink-0" />
                    )}

                    {/* Active indicator */}
                    {isActive && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-accent">
                        Current
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
