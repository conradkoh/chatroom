'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { getActiveStandingInstructions } from '@workspace/backend/src/domain/entities/standing-instructions';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { BookOpen, Plus } from 'lucide-react';
import { memo, useCallback, useState, type KeyboardEvent } from 'react';

import {
  PickerOptionRow,
  PickerPanelHeader,
  PickerScrollBody,
  PickerSearch,
  ResponsivePickerShell,
  filterPickerItems,
  usePickerSearchState,
} from './picker';

type HistoryItem = {
  _id: Id<'chatroom_standingInstructionHistory'>;
  content: string;
  useCount: number;
  lastUsedAt: number;
};

interface StandingInstructionsBarProps {
  chatroomId: Id<'chatroom_rooms'>;
}

const BAR_CHROME =
  'min-h-9 px-3 py-1.5 border-b border-chatroom-status-success/15 bg-chatroom-status-success/5';

const BAR_SHELL = `${BAR_CHROME} flex items-center gap-2`;

const DISABLED_BAR_SHELL =
  'min-h-9 px-3 py-1.5 border-b border-chatroom-border bg-chatroom-bg-secondary flex items-center gap-2';

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

function HistoryInlineList(props: {
  items: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
  onViewMore: () => void;
}) {
  const { items, onSelect, onViewMore } = props;
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-chatroom-border pt-1.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted px-0.5">
        From history
      </div>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item._id}>
            <button
              type="button"
              onClick={() => onSelect(item)}
              className="w-full text-left text-xs text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover px-1.5 py-1 truncate transition-colors cursor-pointer"
              title={item.content}
            >
              {item.content}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onViewMore}
        className="self-start text-[10px] font-bold uppercase tracking-wider text-chatroom-accent hover:opacity-80 px-1.5 py-0.5 cursor-pointer"
      >
        View more
      </button>
    </div>
  );
}

function HistoryFullPicker(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
}) {
  const { open, onOpenChange, items, onSelect } = props;
  const { searchTerm, setSearchTerm, handleOpenChange } = usePickerSearchState(onOpenChange);
  const filtered = filterPickerItems(items, searchTerm, (item) => item.content);

  return (
    <ResponsivePickerShell
      open={open}
      onOpenChange={handleOpenChange}
      title="Standing instruction history"
      align="start"
      contentClassName="w-72 p-0"
      trigger={<span className="sr-only">Standing instruction history</span>}
    >
      <PickerPanelHeader title="Standing instruction history" />
      <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search history…" />
      <PickerScrollBody>
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs text-chatroom-text-muted">No matches</div>
        ) : (
          filtered.map((item) => (
            <PickerOptionRow
              key={item._id}
              selected={false}
              onSelect={() => {
                onSelect(item);
                handleOpenChange(false);
              }}
            >
              {item.content}
            </PickerOptionRow>
          ))
        )}
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
}

function EditingPanel(props: {
  draft: string;
  onDraftChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  historyTop3?: HistoryItem[];
  onSelectHistory?: (item: HistoryItem) => void;
  onViewMoreHistory?: () => void;
}) {
  const {
    draft,
    onDraftChange,
    onConfirm,
    onCancel,
    historyTop3,
    onSelectHistory,
    onViewMoreHistory,
  } = props;
  return (
    <div className={`${BAR_CHROME} flex flex-col gap-1.5`}>
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
      {historyTop3 && onSelectHistory && onViewMoreHistory ? (
        <HistoryInlineList
          items={historyTop3}
          onSelect={onSelectHistory}
          onViewMore={onViewMoreHistory}
        />
      ) : null}
    </div>
  );
}

export const StandingInstructionsBar = memo(function StandingInstructionsBar({
  chatroomId,
}: StandingInstructionsBarProps) {
  const queryResult = useSessionQuery(api.standingInstructions.get, { chatroomId });
  const storedContent = queryResult?.content ?? '';
  const enabled = queryResult?.enabled ?? false;
  const isActive =
    getActiveStandingInstructions({
      standingInstructions: storedContent,
      standingInstructionsEnabled: enabled,
    }) !== null;
  const hasContent = storedContent.trim().length > 0;

  const upsertMutation = useSessionMutation(api.standingInstructions.upsert);
  const setEnabledMutation = useSessionMutation(api.standingInstructions.setEnabled);
  const clearMutation = useSessionMutation(api.standingInstructions.clear);

  const history = useSessionQuery(api.standingInstructions.listHistory, {}) ?? [];
  const recordUseMutation = useSessionMutation(api.standingInstructions.recordUse);

  const [editing, setEditing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState(storedContent);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);

  const handleConfirm = useCallback(async () => {
    await upsertMutation({ chatroomId, content: draft });
    setEditing(false);
    setIsAdding(false);
  }, [chatroomId, draft, upsertMutation]);

  const handleCancel = useCallback(() => {
    setDraft(storedContent);
    setEditing(false);
    setIsAdding(false);
  }, [storedContent]);

  const startEditing = useCallback(() => {
    setDraft(storedContent);
    setActionsOpen(false);
    setIsAdding(false);
    setEditing(true);
  }, [storedContent]);

  const handleDisable = useCallback(async () => {
    setActionsOpen(false);
    await setEnabledMutation({ chatroomId, enabled: false });
  }, [chatroomId, setEnabledMutation]);

  const handleEnable = useCallback(async () => {
    setActionsOpen(false);
    await setEnabledMutation({ chatroomId, enabled: true });
  }, [chatroomId, setEnabledMutation]);

  const handleDelete = useCallback(async () => {
    setActionsOpen(false);
    await clearMutation({ chatroomId });
    setDraft('');
    setEditing(false);
    setIsAdding(false);
  }, [chatroomId, clearMutation]);

  const handleSelectHistory = useCallback(
    async (item: HistoryItem) => {
      const result = await recordUseMutation({ historyId: item._id });
      setDraft(result.content);
      setHistoryPickerOpen(false);
    },
    [recordUseMutation]
  );

  const historyTop3 = history.slice(0, 3);

  if (editing && isAdding) {
    return (
      <>
        <EditingPanel
          draft={draft}
          onDraftChange={setDraft}
          onConfirm={() => {
            void handleConfirm();
          }}
          onCancel={handleCancel}
          historyTop3={historyTop3}
          onSelectHistory={(item) => {
            void handleSelectHistory(item);
          }}
          onViewMoreHistory={() => setHistoryPickerOpen(true)}
        />
        <HistoryFullPicker
          open={historyPickerOpen}
          onOpenChange={setHistoryPickerOpen}
          items={history}
          onSelect={(item) => {
            void handleSelectHistory(item);
          }}
        />
      </>
    );
  }

  if (editing && !isAdding) {
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

  if (!hasContent) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft('');
          setIsAdding(true);
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
          className={`${isActive ? BAR_SHELL : DISABLED_BAR_SHELL} w-full text-left cursor-pointer transition-colors ${isActive ? 'hover:bg-chatroom-status-success/10' : 'hover:bg-chatroom-bg-hover'}`}
        >
          <BookOpen
            size={12}
            className={`shrink-0 ${isActive ? 'text-chatroom-status-success' : 'text-chatroom-text-muted'}`}
          />
          <span
            className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${isActive ? 'text-chatroom-status-success' : 'text-chatroom-text-muted'}`}
          >
            Standing instructions{isActive ? '' : ' (disabled)'}
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
        {isActive ? (
          <PickerOptionRow selected={false} onSelect={handleDisable}>
            Disable
          </PickerOptionRow>
        ) : (
          <PickerOptionRow selected={false} onSelect={handleEnable}>
            Enable
          </PickerOptionRow>
        )}
        <PickerOptionRow selected={false} onSelect={handleDelete}>
          <span className="text-destructive">Delete</span>
        </PickerOptionRow>
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
});
