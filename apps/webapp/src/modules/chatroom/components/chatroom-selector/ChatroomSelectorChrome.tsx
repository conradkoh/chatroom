'use client';

import { LayoutGrid, List, Search, Star, X } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import { ChatroomCard } from './ChatroomCard';
import type { TabType, ViewMode } from './chatroomSelectorModel';
import type { ChatroomWithStatus } from '../../context/ChatroomListingContext';

/** Page header with the title and the "+ New" action. */
export function ChatroomSelectorHeader({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex justify-between items-start mb-6 border-b-2 border-chatroom-border pb-6">
      <div>
        <h1 className="text-lg font-bold uppercase tracking-widest mb-2">Chatrooms</h1>
        <p className="text-chatroom-text-muted text-sm">Select a chatroom or create a new one</p>
      </div>
      <button
        className="bg-chatroom-accent text-chatroom-bg-primary px-4 py-2 font-bold text-xs uppercase tracking-wide cursor-pointer transition-all duration-100 hover:bg-chatroom-text-secondary"
        onClick={onCreate}
      >
        + New
      </button>
    </div>
  );
}

/** Search box. The clear button appears only while a query is set. */
export function ChatroomSearchInput({
  value,
  onChange,
  onClear,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="mb-6">
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-chatroom-text-muted"
        />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search chatrooms..."
          className="w-full bg-chatroom-bg-surface border-2 border-chatroom-border text-chatroom-text-primary pl-9 pr-9 py-2 text-xs font-mono placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent transition-colors"
        />
        {value && (
          <button
            onClick={onClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
            title="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`px-4 py-2 text-xs font-bold uppercase tracking-wide transition-all duration-100 border-b-2 -mb-0.5 ${
        active
          ? 'text-chatroom-accent border-chatroom-accent'
          : 'text-chatroom-text-muted border-transparent hover:text-chatroom-text-secondary'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ViewModeButton({
  active,
  title,
  icon,
  onClick,
}: {
  active: boolean;
  title: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`w-8 h-8 flex items-center justify-center transition-all duration-100 border-2 ${
        active
          ? 'bg-chatroom-accent text-chatroom-bg-primary border-chatroom-accent'
          : 'bg-transparent text-chatroom-text-muted border-chatroom-border hover:text-chatroom-text-primary hover:border-chatroom-border-strong'
      }`}
      onClick={onClick}
      title={title}
    >
      {icon}
    </button>
  );
}

/** Current / Complete tabs on the left, grid / table toggle on the right. */
export function ChatroomTabBar({
  activeTab,
  onTabChange,
  viewMode,
  onViewModeChange,
}: {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex justify-between items-center mb-6 border-b-2 border-chatroom-border">
      <div className="flex gap-0">
        <TabButton
          active={activeTab === 'current'}
          label="Current"
          onClick={() => onTabChange('current')}
        />
        <TabButton
          active={activeTab === 'complete'}
          label="Complete"
          onClick={() => onTabChange('complete')}
        />
      </div>
      <div className="flex gap-1 -mb-0.5 pb-2">
        <ViewModeButton
          active={viewMode === 'grid'}
          title="Grid view"
          icon={<LayoutGrid size={14} />}
          onClick={() => onViewModeChange('grid')}
        />
        <ViewModeButton
          active={viewMode === 'table'}
          title="Table view"
          icon={<List size={14} />}
          onClick={() => onViewModeChange('table')}
        />
      </div>
    </div>
  );
}

/** Favourites row. Shown only on the Current tab with no search query. */
export function FavoritesSection({
  favorites,
  activeTab,
  searchQuery,
  onSelect,
}: {
  favorites: ChatroomWithStatus[];
  activeTab: TabType;
  searchQuery: string;
  onSelect: (chatroomId: string) => void;
}) {
  const show = favorites.length > 0 && activeTab === 'current' && !searchQuery;
  if (!show) return null;
  return (
    <div className="mb-6">
      <h2 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3 flex items-center gap-2">
        <Star size={12} className="text-yellow-500" fill="currentColor" />
        Favorites
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {favorites.map((chatroom) => (
          <ChatroomCard
            key={chatroom._id}
            chatroom={chatroom}
            onSelect={onSelect}
            activeTab={activeTab}
          />
        ))}
      </div>
    </div>
  );
}
