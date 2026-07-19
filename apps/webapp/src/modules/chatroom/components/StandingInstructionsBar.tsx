'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { BookOpen, Plus, X } from 'lucide-react';
import { memo, useCallback, useState, type KeyboardEvent } from 'react';

import { MOBILE_DRAWER_CONTENT_CLASSNAME } from './picker/mobileDrawerLayout';

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsDesktop } from '@/hooks/useIsDesktop';

interface StandingInstructionsBarProps {
  chatroomId: Id<'chatroom_rooms'>;
}

const BAR_SHELL =
  'min-h-9 px-3 py-1.5 border-b border-chatroom-status-info/15 bg-chatroom-status-info/5 flex items-center gap-2';

const ACTION_ROW =
  'w-full min-h-12 px-4 py-3 text-left text-sm font-medium text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors';

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
    <div className="min-h-9 px-3 py-1.5 border-b border-chatroom-status-info/15 bg-chatroom-status-info/5 flex flex-col gap-1.5">
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

function ActionsDrawer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onDisable: () => void;
  onDelete: () => void;
}) {
  const { open, onOpenChange, onEdit, onDisable, onDelete } = props;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className={MOBILE_DRAWER_CONTENT_CLASSNAME}>
        <DrawerHeader>
          <DrawerTitle>Standing instructions</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col p-2 gap-1">
          <button type="button" onClick={onEdit} className={ACTION_ROW}>
            Edit
          </button>
          <button type="button" onClick={onDisable} className={ACTION_ROW}>
            Disable
          </button>
          <button
            type="button"
            onClick={onDelete}
            className={`${ACTION_ROW} text-destructive hover:text-destructive/80`}
          >
            Delete
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function ActiveDesktopBar(props: {
  content: string;
  onEdit: () => void;
  onDisable: () => void;
  onDelete: () => void;
}) {
  const { content, onEdit, onDisable, onDelete } = props;
  return (
    <div className={BAR_SHELL}>
      <BookOpen size={12} className="shrink-0 text-chatroom-status-info" />
      <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info shrink-0">
        Standing instructions
      </span>
      <span className="text-xs text-chatroom-text-secondary truncate flex-1">{content}</span>
      <button
        type="button"
        onClick={onEdit}
        className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info hover:text-chatroom-status-info/70 transition-colors shrink-0"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={onDisable}
        className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors shrink-0"
      >
        Disable
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-destructive transition-colors shrink-0"
      >
        <X size={10} />
      </button>
    </div>
  );
}

function ActiveMobileBar(props: { content: string; onOpenActions: () => void }) {
  const { content, onOpenActions } = props;
  return (
    <button
      type="button"
      onClick={onOpenActions}
      className={`${BAR_SHELL} w-full text-left cursor-pointer hover:bg-chatroom-status-info/10 transition-colors`}
    >
      <BookOpen size={12} className="shrink-0 text-chatroom-status-info" />
      <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info shrink-0">
        Standing instructions
      </span>
      <span className="text-xs text-chatroom-text-secondary truncate flex-1">{content}</span>
    </button>
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
  const isDesktop = useIsDesktop();

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
        className={`${BAR_SHELL} w-full text-left hover:bg-chatroom-status-info/10 transition-colors cursor-pointer`}
      >
        <Plus size={12} className="shrink-0 text-chatroom-status-info" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info">
          Add standing instructions
        </span>
      </button>
    );
  }

  if (isDesktop) {
    return (
      <ActiveDesktopBar
        content={storedContent}
        onEdit={startEditing}
        onDisable={handleDisable}
        onDelete={handleDelete}
      />
    );
  }

  return (
    <>
      <ActiveMobileBar content={storedContent} onOpenActions={() => setActionsOpen(true)} />
      <ActionsDrawer
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        onEdit={startEditing}
        onDisable={handleDisable}
        onDelete={handleDelete}
      />
    </>
  );
});
