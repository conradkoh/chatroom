'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { BookOpen, Plus } from 'lucide-react';
import { memo, useCallback, useState, type KeyboardEvent } from 'react';

import { PickerOptionRow, PickerScrollBody, ResponsivePickerShell } from './picker';

interface StandingInstructionsBarProps {
  chatroomId: Id<'chatroom_rooms'>;
}

const BAR_SHELL =
  'min-h-9 px-3 py-1.5 border-b border-chatroom-status-success/15 bg-chatroom-status-success/5 flex items-center gap-2';

function wantsStandingConfirm(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== 'Enter') return false;
  return e.metaKey || e.ctrlKey;
}

function onStandingEditorKeyDown(
  e: KeyboardEvent<HTMLTextAreaElement>,
  onCancel: () => void,
  onConfirm: () => void
): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    onCancel();
    return;
  }
  if (!wantsStandingConfirm(e)) return;
  e.preventDefault();
  onConfirm();
}

function EditingPanel(props: {
  draft: string;
  onDraftChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { draft, onDraftChange, onConfirm, onCancel } = props;
  return (
    <div className="min-h-9 px-3 py-1.5 border-b border-chatroom-status-success/15 bg-chatroom-status-success/5 flex flex-col gap-1.5">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => onStandingEditorKeyDown(e, onCancel, onConfirm)}
        placeholder="Enter standing instructions…"
        className="w-full bg-chatroom-bg-primary border border-chatroom-border px-2 py-1 text-xs text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent resize-none"
        rows={3}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 bg-chatroom-accent text-chatroom-text-on-accent hover:opacity-80 transition-opacity"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export const StandingInstructionsBar = memo(function StandingInstructionsBar({
  chatroomId,
}: StandingInstructionsBarProps) {
  const queryResult = useSessionQuery(api.standingInstructions.get, { chatroomId });
  const storedContent = queryResult?.content ?? '';
  const isActive = (queryResult?.enabled ?? false) && storedContent.trim().length > 0;

  const upsertMutation = useSessionMutation(api.standingInstructions.upsert);
  const setEnabledMutation = useSessionMutation(api.standingInstructions.setEnabled);
  const clearMutation = useSessionMutation(api.standingInstructions.clear);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(storedContent);
  const [actionsOpen, setActionsOpen] = useState(false);

  const handleConfirm = useCallback(async () => {
    await upsertMutation({ chatroomId, content: draft });
    setEditing(false);
  }, [chatroomId, draft, upsertMutation]);

  const handleCancel = useCallback(() => {
    setDraft(storedContent);
    setEditing(false);
  }, [storedContent]);

  const startEditing = useCallback(() => {
    setDraft(storedContent);
    setActionsOpen(false);
    setEditing(true);
  }, [storedContent]);

  const handleDisable = useCallback(async () => {
    setActionsOpen(false);
    await setEnabledMutation({ chatroomId, enabled: false });
  }, [chatroomId, setEnabledMutation]);

  const handleDelete = useCallback(async () => {
    setActionsOpen(false);
    await clearMutation({ chatroomId });
    setDraft('');
    setEditing(false);
  }, [chatroomId, clearMutation]);

  if (editing) {
    return (
      <EditingPanel
        draft={draft}
        onDraftChange={setDraft}
        onConfirm={() => {
          void handleConfirm();
        }}
        onCancel={handleCancel}
      />
    );
  }

  if (!isActive) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft('');
          setEditing(true);
        }}
        className={`${BAR_SHELL} w-full text-left hover:bg-chatroom-status-success/10 transition-colors cursor-pointer`}
      >
        <Plus size={12} className="shrink-0 text-chatroom-status-success" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-success">
          Add standing instructions
        </span>
      </button>
    );
  }

  return (
    <ResponsivePickerShell
      open={actionsOpen}
      onOpenChange={setActionsOpen}
      title="Standing instructions"
      align="start"
      contentClassName="w-56 p-0"
      trigger={
        <button
          type="button"
          className={`${BAR_SHELL} w-full text-left cursor-pointer hover:bg-chatroom-status-success/10 transition-colors`}
        >
          <BookOpen size={12} className="shrink-0 text-chatroom-status-success" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-success shrink-0">
            Standing instructions
          </span>
          <span className="text-xs text-chatroom-text-secondary truncate flex-1">
            {storedContent}
          </span>
        </button>
      }
    >
      <PickerScrollBody>
        <PickerOptionRow selected={false} onSelect={startEditing}>
          Edit
        </PickerOptionRow>
        <PickerOptionRow selected={false} onSelect={handleDisable}>
          Disable
        </PickerOptionRow>
        <PickerOptionRow selected={false} onSelect={handleDelete}>
          <span className="text-destructive">Delete</span>
        </PickerOptionRow>
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
});
