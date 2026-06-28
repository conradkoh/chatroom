'use client';

import { memo } from 'react';

import { useChatroomTitleEditor } from './useChatroomTitleEditor';
import { normalizePastedChatroomName } from '../utils/normalizeChatroomName';

import { InlineEditableTitle } from '@/components/inline-editable-title/InlineEditableTitle';

interface ChatroomTitleEditorProps {
  displayName: string;
  chatroomId: string;
}

export const ChatroomTitleEditor = memo(function ChatroomTitleEditor({
  displayName,
  chatroomId,
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

  return (
    <InlineEditableTitle
      value={displayName}
      editedValue={editedName}
      onEditedValueChange={setEditedName}
      isEditing={isEditing}
      onStartEdit={handleStartEdit}
      onCancel={handleCancel}
      onSave={() => void handleSave()}
      isPending={isPending}
      maxLength={100}
      placeholder="Enter name..."
      editButtonTitle="Rename chatroom"
      saveButtonTitle="Save name"
      inputAriaLabel="Chatroom name"
      onPaste={(event) => {
        const pasted = event.clipboardData.getData('text');
        if (!pasted.includes('/') && !pasted.includes('\\')) return;
        event.preventDefault();
        setEditedName(normalizePastedChatroomName(pasted));
      }}
    />
  );
});
