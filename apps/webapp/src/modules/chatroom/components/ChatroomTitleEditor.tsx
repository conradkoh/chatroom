'use client';

import {
  ArrowRightLeft,
  ChevronDown,
  Maximize2,
  Minimize2,
  Monitor,
  PanelRightOpen,
  Pencil,
  Settings,
  User,
} from 'lucide-react';
import { memo } from 'react';

import { ChatroomFocusModeToggle } from './ChatroomFocusModeToggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useChatroomTitleEditor } from './useChatroomTitleEditor';
import { normalizePastedChatroomName } from '../utils/normalizeChatroomName';

import {
  inlineEditableTitleDisplayClassName,
  inlineEditableTitleInputClassName,
} from '@/components/inline-editable-title/inline-editable-title-styles';
import { InlineEditableTitleEditing } from '@/components/inline-editable-title/InlineEditableTitleEditing';
import { cn } from '@/lib/utils';
import { getLocalManagerUrl } from '@/lib/environment';
import { openExternalUrl } from '@/lib/navigation';
import {
  getChatStatusDescription,
  getChatStatusIndicatorClasses,
} from '@/modules/chatroom/utils/chatStatusDisplay';
import type { ChatStatus } from '@/modules/chatroom/utils/deriveChatStatus';

const chatroomTitleDisplayClassName = cn(inlineEditableTitleDisplayClassName, 'text-sm');
const chatroomTitleInputClassName = cn(inlineEditableTitleInputClassName, 'text-sm');

export interface ChatroomTitleEditorProps {
  displayName: string;
  chatroomId: string;
  chatStatus: ChatStatus;
  isDesktop?: boolean;
  onOpenSettings?: () => void;
  onSwitchChatrooms?: () => void;
  onOpenProfile?: () => void;
  focusModeActive?: boolean;
  onEnableFocusMode?: () => void;
  onDisableFocusMode?: () => void;
  onShowAgentsSidebar?: () => void;
}

// fallow-ignore-next-line complexity
export const ChatroomTitleEditor = memo(function ChatroomTitleEditor({
  displayName,
  chatroomId,
  chatStatus,
  isDesktop = false,
  onOpenSettings,
  onSwitchChatrooms,
  onOpenProfile,
  focusModeActive = false,
  onEnableFocusMode,
  onDisableFocusMode,
  onShowAgentsSidebar,
}: ChatroomTitleEditorProps) {
  const {
    isEditing,
    editedName,
    setEditedName,
    isPending,
    handleStartEdit,
    handleCancel,
    handleSave,
  } = useChatroomTitleEditor(displayName, chatroomId);

  if (isEditing) {
    return (
      <InlineEditableTitleEditing
        editedValue={editedName}
        onEditedValueChange={setEditedName}
        onCancel={handleCancel}
        onSave={() => void handleSave()}
        isPending={isPending}
        maxLength={100}
        placeholder="Enter name..."
        saveButtonTitle="Save name"
        cancelButtonTitle="Cancel"
        inputAriaLabel="Chatroom name"
        inputClassName={chatroomTitleInputClassName}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData('text');
          if (!pasted.includes('/') && !pasted.includes('\\')) return;
          event.preventDefault();
          setEditedName(normalizePastedChatroomName(pasted));
        }}
      />
    );
  }

  const showFocusModeItem =
    isDesktop && (focusModeActive ? !!onDisableFocusMode : !!onEnableFocusMode);
  const showAgentsItem = !isDesktop && !!onShowAgentsSidebar;
  const showNavSection = !!(
    onSwitchChatrooms ||
    onOpenProfile ||
    showFocusModeItem ||
    showAgentsItem
  );

  const showFocusModeToggle = showFocusModeItem;
  const handleToggleFocusMode = () => {
    if (focusModeActive) {
      onDisableFocusMode?.();
      return;
    }
    onEnableFocusMode?.();
  };

  return (
    <div className="flex items-center min-w-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 min-w-0 cursor-pointer bg-transparent border-0 p-0 hover:text-chatroom-text-secondary transition-colors duration-100 text-chatroom-text-primary outline-none focus:outline-none focus-visible:outline-none"
            title={displayName}
            aria-label={`Chatroom: ${displayName}. Open menu`}
          >
            <span
              className={getChatStatusIndicatorClasses(chatStatus)}
              title={getChatStatusDescription(chatStatus)}
              aria-label={getChatStatusDescription(chatStatus)}
            />
            <span className={chatroomTitleDisplayClassName}>{displayName}</span>
            <ChevronDown size={14} className="shrink-0 text-chatroom-text-muted" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[160px]">
          <DropdownMenuItem
            onClick={handleStartEdit}
            className="flex items-center gap-2 cursor-pointer"
          >
            <Pencil size={14} />
            Edit Name
          </DropdownMenuItem>
          {onOpenSettings && (
            <DropdownMenuItem
              onClick={onOpenSettings}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Settings size={14} />
              Settings
            </DropdownMenuItem>
          )}

          {showNavSection && <DropdownMenuSeparator />}

          {onSwitchChatrooms && (
            <DropdownMenuItem
              onClick={onSwitchChatrooms}
              className="flex items-center gap-2 cursor-pointer"
            >
              <ArrowRightLeft size={14} />
              Switch Chatrooms
            </DropdownMenuItem>
          )}

          {showFocusModeItem && (
            <DropdownMenuItem
              onClick={focusModeActive ? onDisableFocusMode : onEnableFocusMode}
              className="flex items-center gap-2 cursor-pointer"
            >
              {focusModeActive ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
              {focusModeActive ? 'Disable Focus Mode' : 'Enable Focus Mode'}
            </DropdownMenuItem>
          )}

          {showAgentsItem && (
            <DropdownMenuItem
              onClick={onShowAgentsSidebar}
              className="flex items-center gap-2 cursor-pointer"
            >
              <PanelRightOpen size={14} />
              Show Agent Sidebar
            </DropdownMenuItem>
          )}

          {onOpenProfile && (
            <DropdownMenuItem
              onClick={onOpenProfile}
              className="flex items-center gap-2 cursor-pointer"
            >
              <User size={14} />
              User Profile
            </DropdownMenuItem>
          )}

          {getLocalManagerUrl() && (
            <DropdownMenuItem
              onClick={() => openExternalUrl(getLocalManagerUrl()!)}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Monitor size={14} />
              Chatroom Local Manager
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {showFocusModeToggle && (
        <ChatroomFocusModeToggle
          focusModeActive={focusModeActive}
          onToggle={handleToggleFocusMode}
        />
      )}
    </div>
  );
});
