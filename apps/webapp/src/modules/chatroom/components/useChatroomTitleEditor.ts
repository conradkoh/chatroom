'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';

export function useChatroomTitleEditor(displayName: string, chatroomId: string) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isPending, setIsPending] = useState(false);
  const renameChatroom = useSessionMutation(api.chatrooms.rename);

  const handleStartEdit = useCallback(() => {
    setEditedName(displayName);
    setIsEditing(true);
  }, [displayName]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditedName('');
  }, []);

  const handleSave = useCallback(async () => {
    if (!editedName.trim()) {
      handleCancel();
      return;
    }
    setIsPending(true);
    try {
      await renameChatroom({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        name: editedName.trim(),
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to rename chatroom:', error);
    } finally {
      setIsPending(false);
    }
  }, [editedName, renameChatroom, chatroomId, handleCancel]);

  return {
    isEditing,
    editedName,
    setEditedName,
    isPending,
    handleStartEdit,
    handleCancel,
    handleSave,
  };
}
