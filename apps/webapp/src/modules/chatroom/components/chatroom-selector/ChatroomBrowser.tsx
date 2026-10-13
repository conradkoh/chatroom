'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { CompletedChatroomList, CurrentChatroomList } from './ChatroomListSections';
import {
  ChatroomSearchInput,
  ChatroomSelectorHeader,
  ChatroomTabBar,
  FavoritesSection,
} from './ChatroomSelectorChrome';
import { filterChatrooms, type TabType, type ViewMode } from './chatroomSelectorModel';
import type { ChatroomWithStatus } from '../../context/ChatroomListingContext';
import {
  flattenPartitionedCurrent,
  partitionChatroomListing,
} from '../../utils/partitionChatroomListing';

import type { ChatroomStatus } from '@/domain/entities/chatroom-status';

interface ChatroomBrowserProps {
  chatrooms: ChatroomWithStatus[];
  statuses: ReadonlyMap<string, ChatroomStatus>;
  onSelect: (chatroomId: string) => void;
  onCreate: () => void;
}

/**
 * The chatroom list once at least one chatroom exists: search, favourites, the Current and
 * Complete tabs, and grid or table views.
 */
export function ChatroomBrowser({ chatrooms, statuses, onSelect, onCreate }: ChatroomBrowserProps) {
  const [activeTab, setActiveTab] = useState<TabType>('current');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  }, []);

  // Filter by the search query, then group into priority sections.
  const filtered = useMemo(() => filterChatrooms(chatrooms, searchQuery), [chatrooms, searchQuery]);
  const partitioned = useMemo(
    () => partitionChatroomListing(filtered, statuses),
    [filtered, statuses]
  );
  const orderedCurrent = useMemo(() => flattenPartitionedCurrent(partitioned), [partitioned]);
  const favorites = useMemo(() => filtered.filter((c) => c.isFavorite), [filtered]);

  return (
    <div className="chatroom-root min-h-screen bg-chatroom-bg-primary text-chatroom-text-primary p-6">
      <ChatroomSelectorHeader onCreate={onCreate} />
      <ChatroomSearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        onClear={handleClearSearch}
        inputRef={searchInputRef}
      />
      <FavoritesSection
        favorites={favorites}
        activeTab={activeTab}
        searchQuery={searchQuery}
        onSelect={onSelect}
      />
      <ChatroomTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
      {activeTab === 'current' ? (
        <CurrentChatroomList
          viewMode={viewMode}
          partitioned={partitioned}
          orderedCurrent={orderedCurrent}
          statuses={statuses}
          searchQuery={searchQuery}
          onSelect={onSelect}
          activeTab={activeTab}
        />
      ) : (
        <CompletedChatroomList
          viewMode={viewMode}
          completed={partitioned.completed}
          statuses={statuses}
          searchQuery={searchQuery}
          onSelect={onSelect}
          activeTab={activeTab}
        />
      )}
    </div>
  );
}
