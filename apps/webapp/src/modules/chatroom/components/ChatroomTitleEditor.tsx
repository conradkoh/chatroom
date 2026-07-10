'use client';

import { ArrowLeft, ChevronDown, Pencil, Settings } from 'lucide-react';
import { memo } from 'react';

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

const chatroomTitleDisplayClassName = cn(inlineEditableTitleDisplayClassName, 'text-sm');
const chatroomTitleInputClassName = cn(inlineEditableTitleInputClassName, 'text-sm');

interface ChatroomTitleEditorProps {
  displayName: string;
  chatroomId: string;
  onBack?: () => void;
  onOpenSettings?: () => void;
}

export const ChatroomTitleEditor = memo(function ChatroomTitleEditor({
  displayName,
  chatroomId,
  onBack,
  onOpenSettings,
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 min-w-0 cursor-pointer bg-transparent border-0 p-0 hover:text-chatroom-text-secondary transition-colors duration-100 text-chatroom-text-primary"
          title={displayName}
          aria-label={`Chatroom: ${displayName}. Open menu`}
        >
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
        {onBack && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onBack} className="flex items-center gap-2 cursor-pointer">
              <ArrowLeft size={14} />
              Back to chatroom list
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
