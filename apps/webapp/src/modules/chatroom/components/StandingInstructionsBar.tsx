'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { BookOpen, Plus, X } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

interface StandingInstructionsBarProps {
  chatroomId: Id<'chatroom_rooms'>;
}

export const StandingInstructionsBar = memo(function StandingInstructionsBar({
  chatroomId,
}: StandingInstructionsBarProps) {
  const queryResult = useSessionQuery(api.standingInstructions.get, { chatroomId });
  const { content: storedContent, enabled: storedEnabled } = queryResult ?? {
    content: '',
    enabled: false,
  };

  const upsertMutation = useSessionMutation(api.standingInstructions.upsert);
  const setEnabledMutation = useSessionMutation(api.standingInstructions.setEnabled);
  const clearMutation = useSessionMutation(api.standingInstructions.clear);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(storedContent);
  const isActive = storedEnabled && storedContent.trim().length > 0;

  const handleConfirm = useCallback(async () => {
    await upsertMutation({ chatroomId, content: draft });
    setEditing(false);
  }, [chatroomId, draft, upsertMutation]);

  const handleCancel = useCallback(() => {
    setDraft(storedContent);
    setEditing(false);
  }, [storedContent]);

  const handleDisable = useCallback(async () => {
    await setEnabledMutation({ chatroomId, enabled: false });
  }, [chatroomId, setEnabledMutation]);

  const handleDelete = useCallback(async () => {
    await clearMutation({ chatroomId });
    setDraft('');
    setEditing(false);
  }, [chatroomId, clearMutation]);

  if (editing) {
    return (
      <div className="min-h-9 px-3 py-1.5 border-b border-chatroom-status-info/15 bg-chatroom-status-info/5 flex flex-col gap-1.5">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Enter standing instructions…"
          className="w-full bg-chatroom-bg-primary border border-chatroom-border px-2 py-1 text-xs text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent resize-none"
          rows={3}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 bg-chatroom-accent text-white hover:opacity-80 transition-opacity"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (isActive) {
    return (
      <div className="min-h-9 px-3 py-1.5 border-b border-chatroom-status-info/15 bg-chatroom-status-info/5 flex items-center gap-2">
        <BookOpen size={12} className="shrink-0 text-chatroom-status-info" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info shrink-0">
          Standing instructions
        </span>
        <span className="text-xs text-chatroom-text-secondary truncate flex-1">
          {storedContent}
        </span>
        <button
          type="button"
          onClick={() => {
            setDraft(storedContent);
            setEditing(true);
          }}
          className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info hover:text-chatroom-status-info/70 transition-colors shrink-0"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={handleDisable}
          className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors shrink-0"
        >
          Disable
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-destructive transition-colors shrink-0"
        >
          <X size={10} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft('');
        setEditing(true);
      }}
      className="w-full min-h-9 px-3 py-1.5 border-b border-chatroom-status-info/15 bg-chatroom-status-info/5 flex items-center gap-2 text-left hover:bg-chatroom-status-info/10 transition-colors cursor-pointer"
    >
      <Plus size={12} className="shrink-0 text-chatroom-status-info" />
      <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info">
        Add standing instructions
      </span>
    </button>
  );
});
