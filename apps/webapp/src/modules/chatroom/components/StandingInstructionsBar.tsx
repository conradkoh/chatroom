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
  getMobileDrawerContentStyle,
  usePickerSearchState,
} from './picker';
import { MOBILE_DRAWER_CONTENT_CLASSNAME } from './picker/mobileDrawerLayout';
import { useOverlayPortalContainer } from './shared/overlayPortalContainer';

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportKeyboardInset } from '@/hooks/useMobileKeyboard';

type HistoryItem = {
  _id: Id<'chatroom_standingInstructionHistory'>;
  content: string;
  useCount: number;
  lastUsedAt: number;
};

interface StandingInstructionsBarProps {
  chatroomId: Id<'chatroom_rooms'>;
}

function mobileLabelText(isDesktop: boolean): string {
  return isDesktop ? 'text-[10px]' : 'text-xs';
}

function mobileIconSize(isDesktop: boolean): number {
  return isDesktop ? 12 : 14;
}

const BAR_CHROME = 'px-3 border-b border-chatroom-status-success/15 bg-chatroom-status-success/5';

const BAR_SHELL = `${BAR_CHROME} flex items-center gap-2`;

const DISABLED_BAR_SHELL =
  'px-3 border-b border-chatroom-border bg-chatroom-bg-secondary flex items-center gap-2';

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

type AddSelection = HistoryItem['_id'] | 'create-new' | null;

function HistorySelectionList(props: {
  items: HistoryItem[];
  selection: AddSelection;
  onSelectHistory: (item: HistoryItem) => void;
  onSelectCreateNew: () => void;
}) {
  const { items, selection, onSelectHistory, onSelectCreateNew } = props;

  return (
    <ul className="flex flex-col border border-chatroom-border divide-y divide-chatroom-border">
      {items.map((item) => (
        <li key={item._id}>
          <PickerOptionRow
            selected={selection === item._id}
            onSelect={() => onSelectHistory(item)}
            className="rounded-none"
          >
            {item.content}
          </PickerOptionRow>
        </li>
      ))}
      <li>
        <PickerOptionRow
          selected={selection === 'create-new'}
          onSelect={onSelectCreateNew}
          className="rounded-none"
        >
          Create new
        </PickerOptionRow>
      </li>
    </ul>
  );
}

function AddingPanelHeader(props: { onViewMore: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary">
        Standing Instructions
      </span>
      <button
        type="button"
        onClick={props.onViewMore}
        data-testid="standing-instructions-view-more"
        className="text-[10px] font-bold uppercase tracking-wider text-chatroom-accent hover:opacity-80 cursor-pointer shrink-0"
      >
        View more
      </button>
    </div>
  );
}

function AddingPanel(props: {
  historyTop3: HistoryItem[];
  selection: AddSelection;
  draft: string;
  onDraftChange: (value: string) => void;
  onSelectHistory: (item: HistoryItem) => void;
  onSelectCreateNew: () => void;
  onViewMore: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled: boolean;
}) {
  const {
    historyTop3,
    selection,
    draft,
    onDraftChange,
    onSelectHistory,
    onSelectCreateNew,
    onViewMore,
    onConfirm,
    onCancel,
    confirmDisabled,
  } = props;

  return (
    <div className={`${BAR_CHROME} flex flex-col gap-1.5`}>
      <AddingPanelHeader onViewMore={onViewMore} />
      <HistorySelectionList
        items={historyTop3}
        selection={selection}
        onSelectHistory={onSelectHistory}
        onSelectCreateNew={onSelectCreateNew}
      />
      {selection === 'create-new' ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => onStandingEditorKeyDown(e, onCancel, onConfirm)}
          placeholder="Enter standing instructions…"
          className="w-full bg-chatroom-bg-primary border border-chatroom-border px-2 py-1 text-xs text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent resize-none"
          rows={3}
        />
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmDisabled}
          className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 bg-chatroom-accent text-chatroom-text-on-accent hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
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

function MobileAddingDrawer(props: {
  open: boolean;
  historyTop3: HistoryItem[];
  selection: AddSelection;
  draft: string;
  onDraftChange: (value: string) => void;
  onSelectHistory: (item: HistoryItem) => void;
  onSelectCreateNew: () => void;
  onViewMore: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled: boolean;
}) {
  const {
    open,
    historyTop3,
    selection,
    draft,
    onDraftChange,
    onSelectHistory,
    onSelectCreateNew,
    onViewMore,
    onConfirm,
    onCancel,
    confirmDisabled,
  } = props;
  const keyboardInsetPx = useVisualViewportKeyboardInset(open);
  const portalContainer = useOverlayPortalContainer();

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
      nested
      repositionInputs={false}
      handleOnly
      container={portalContainer ?? undefined}
    >
      <DrawerContent
        className={MOBILE_DRAWER_CONTENT_CLASSNAME}
        style={getMobileDrawerContentStyle(keyboardInsetPx)}
      >
        <DrawerHeader className="p-0 shrink-0">
          <DrawerTitle className="sr-only">Add standing instructions</DrawerTitle>
        </DrawerHeader>
        <PickerPanelHeader title="Standing Instructions">
          <button
            type="button"
            onClick={onViewMore}
            className="text-[10px] font-bold uppercase tracking-wider text-chatroom-accent hover:opacity-80 cursor-pointer shrink-0"
          >
            View more
          </button>
        </PickerPanelHeader>
        <div className="flex flex-col gap-3 p-3">
          <HistorySelectionList
            items={historyTop3}
            selection={selection}
            onSelectHistory={onSelectHistory}
            onSelectCreateNew={onSelectCreateNew}
          />
          {selection === 'create-new' ? (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => onStandingEditorKeyDown(e, onCancel, onConfirm)}
              placeholder="Enter standing instructions…"
              rows={5}
              className="w-full min-h-[120px] bg-chatroom-bg-primary border border-chatroom-border px-3 py-3 text-sm text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent resize-none"
            />
          ) : null}
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmDisabled}
              className="min-h-11 flex-1 text-sm font-bold uppercase tracking-wider px-4 py-3 bg-chatroom-accent text-chatroom-text-on-accent hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 flex-1 text-sm font-bold uppercase tracking-wider px-4 py-3 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors border border-chatroom-border"
            >
              Cancel
            </button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
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
}) {
  const { draft, onDraftChange, onConfirm, onCancel } = props;
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
    </div>
  );
}

function MobileEditingDrawer(props: {
  open: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { open, draft, onDraftChange, onConfirm, onCancel } = props;
  const keyboardInsetPx = useVisualViewportKeyboardInset(open);
  const portalContainer = useOverlayPortalContainer();

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
      nested
      repositionInputs={false}
      handleOnly
      container={portalContainer ?? undefined}
    >
      <DrawerContent
        className={MOBILE_DRAWER_CONTENT_CLASSNAME}
        style={getMobileDrawerContentStyle(keyboardInsetPx)}
      >
        <DrawerHeader className="p-0 shrink-0">
          <DrawerTitle className="sr-only">Edit standing instructions</DrawerTitle>
        </DrawerHeader>
        <PickerPanelHeader title="Edit standing instructions" />
        <div className="flex flex-col gap-3 p-3">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => onStandingEditorKeyDown(e, onCancel, onConfirm)}
            placeholder="Enter standing instructions…"
            rows={5}
            className="w-full min-h-[120px] bg-chatroom-bg-primary border border-chatroom-border px-3 py-3 text-sm text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent resize-none"
          />
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className="min-h-11 flex-1 text-sm font-bold uppercase tracking-wider px-4 py-3 bg-chatroom-accent text-chatroom-text-on-accent hover:opacity-80 transition-opacity"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 flex-1 text-sm font-bold uppercase tracking-wider px-4 py-3 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors border border-chatroom-border"
            >
              Cancel
            </button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export const StandingInstructionsBar = memo(function StandingInstructionsBar({
  chatroomId,
}: StandingInstructionsBarProps) {
  const isDesktop = useIsDesktop();
  const actionRowClassName = isDesktop ? undefined : 'min-h-11 py-3 text-sm';
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
  const [addSelection, setAddSelection] = useState<AddSelection>(null);
  const [draft, setDraft] = useState(storedContent);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);

  const handleConfirm = useCallback(async () => {
    await upsertMutation({ chatroomId, content: draft });
    setEditing(false);
    setIsAdding(false);
    setAddSelection(null);
  }, [chatroomId, draft, upsertMutation]);

  const handleCancel = useCallback(() => {
    setDraft(storedContent);
    setEditing(false);
    setIsAdding(false);
    setAddSelection(null);
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
      setAddSelection(item._id);
      setHistoryPickerOpen(false);
    },
    [recordUseMutation]
  );

  const handleSelectCreateNew = useCallback(() => {
    setAddSelection('create-new');
    setDraft('');
  }, []);

  const historyTop3 = history.slice(0, 3);

  const confirmDisabled =
    addSelection === null || (addSelection === 'create-new' && draft.trim().length === 0);

  const addingPanelProps = {
    historyTop3,
    selection: addSelection,
    draft,
    onDraftChange: setDraft,
    onSelectHistory: (item: HistoryItem) => {
      void handleSelectHistory(item);
    },
    onSelectCreateNew: handleSelectCreateNew,
    onViewMore: () => setHistoryPickerOpen(true),
    onConfirm: () => {
      void handleConfirm();
    },
    onCancel: handleCancel,
    confirmDisabled,
  };

  const editorHandlers = {
    draft,
    onDraftChange: setDraft,
    onConfirm: () => {
      void handleConfirm();
    },
    onCancel: handleCancel,
  };

  const historyFullPicker = isAdding ? (
    <HistoryFullPicker
      open={historyPickerOpen}
      onOpenChange={setHistoryPickerOpen}
      items={history}
      onSelect={(item) => {
        void handleSelectHistory(item);
      }}
    />
  ) : null;

  if (editing && isDesktop && isAdding) {
    return (
      <>
        <AddingPanel {...addingPanelProps} />
        {historyFullPicker}
      </>
    );
  }

  if (editing && isDesktop && !isAdding) {
    return (
      <>
        <EditingPanel {...editorHandlers} />
        {historyFullPicker}
      </>
    );
  }

  const mobileAddDrawer =
    editing && !isDesktop && isAdding ? (
      <MobileAddingDrawer open={editing} {...addingPanelProps} />
    ) : null;

  const mobileEditor =
    editing && !isDesktop && !isAdding ? (
      <MobileEditingDrawer open={editing} {...editorHandlers} />
    ) : null;

  if (!hasContent) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setDraft('');
            setAddSelection(null);
            setIsAdding(true);
            setEditing(true);
          }}
          className={`${BAR_SHELL} w-full text-left hover:bg-chatroom-status-success/10 transition-colors cursor-pointer`}
        >
          <Plus
            size={mobileIconSize(isDesktop)}
            className="shrink-0 text-chatroom-status-success"
          />
          <span
            className={`${mobileLabelText(isDesktop)} font-bold uppercase tracking-wider text-chatroom-status-success`}
          >
            Add standing instructions
          </span>
        </button>
        {mobileAddDrawer}
        {mobileEditor}
        {historyFullPicker}
      </>
    );
  }

  return (
    <>
      <ResponsivePickerShell
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title="Standing instructions"
        anchorToPointer
        contentClassName="w-56 p-0"
        trigger={
          <button
            type="button"
            className={`${isActive ? BAR_SHELL : DISABLED_BAR_SHELL} w-full text-left cursor-pointer transition-colors ${isActive ? 'hover:bg-chatroom-status-success/10' : 'hover:bg-chatroom-bg-hover'}`}
          >
            <BookOpen
              size={mobileIconSize(isDesktop)}
              className={`shrink-0 ${isActive ? 'text-chatroom-status-success' : 'text-chatroom-text-muted'}`}
            />
            <span
              className={`${mobileLabelText(isDesktop)} font-bold uppercase tracking-wider shrink-0 ${isActive ? 'text-chatroom-status-success' : 'text-chatroom-text-muted'}`}
            >
              Standing instructions{isActive ? '' : ' (disabled)'}
            </span>
            <span className="text-xs text-chatroom-text-secondary truncate flex-1">
              {storedContent}
            </span>
          </button>
        }
      >
        <PickerPanelHeader title="Standing instructions" />
        <PickerScrollBody>
          <PickerOptionRow selected={false} onSelect={startEditing} className={actionRowClassName}>
            Edit
          </PickerOptionRow>
          {isActive ? (
            <PickerOptionRow
              selected={false}
              onSelect={handleDisable}
              className={actionRowClassName}
            >
              Disable
            </PickerOptionRow>
          ) : (
            <PickerOptionRow
              selected={false}
              onSelect={handleEnable}
              className={actionRowClassName}
            >
              Enable
            </PickerOptionRow>
          )}
          <PickerOptionRow selected={false} onSelect={handleDelete} className={actionRowClassName}>
            <span className="text-destructive">Delete</span>
          </PickerOptionRow>
        </PickerScrollBody>
      </ResponsivePickerShell>
      {mobileAddDrawer}
      {mobileEditor}
      {historyFullPicker}
    </>
  );
});
