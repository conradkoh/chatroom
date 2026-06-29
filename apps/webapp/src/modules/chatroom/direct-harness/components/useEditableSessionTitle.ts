'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { HarnessSessionSummary } from '@workspace/backend/src/domain/direct-harness/types';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';

import { displaySessionTitle } from '../utils/displaySessionTitle';

export function useEditableSessionTitle(
  harnessSessionId: Id<'chatroom_harnessSessions'>,
  sessionSummary: HarnessSessionSummary
) {
  const displayTitle = displaySessionTitle(sessionSummary);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [isPending, setIsPending] = useState(false);
  const renameSession = useSessionMutation(api.web.directHarness.sessions.renameSession);

  const startEditing = useCallback(() => {
    setEditedTitle(displayTitle);
    setIsEditing(true);
  }, [displayTitle]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = editedTitle.trim();
    if (!trimmed) {
      handleCancel();
      return;
    }

    const storedTitle = sessionSummary.sessionTitle?.trim() ?? '';
    if (trimmed === storedTitle) {
      setIsEditing(false);
      return;
    }

    setIsPending(true);
    try {
      await renameSession({ harnessSessionId, sessionTitle: trimmed });
      setIsEditing(false);
    } finally {
      setIsPending(false);
    }
  }, [editedTitle, handleCancel, harnessSessionId, renameSession, sessionSummary.sessionTitle]);

  return {
    displayTitle,
    editedTitle,
    setEditedTitle,
    isEditing,
    isPending,
    startEditing,
    handleCancel,
    handleSave,
  };
}
