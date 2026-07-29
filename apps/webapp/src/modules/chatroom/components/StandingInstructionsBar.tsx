'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { getActiveStandingInstructions } from '@workspace/backend/src/domain/entities/standing-instructions';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { BookOpen, Plus } from 'lucide-react';
import { memo, useCallback, useMemo, useState, type KeyboardEvent } from 'react';

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
import { StandingInstructionsDialog } from '../features/standing-instructions/components';
import type { StandingInstructionsDialogInitialView } from '../features/standing-instructions/types/standingInstructionsDialog';

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

const BAR_CHROME_BASE = 'px-3 border-chatroom-status-success/15 bg-chatroom-status-success/5';

const BAR_ROW_CHROME = `${BAR_CHROME_BASE} py-1.5`;

const PANEL_CHROME = `${BAR_CHROME_BASE} py-1.5`;

const BAR_SHELL = `${BAR_ROW_CHROME} flex items-center gap-2 h-full`;

const DISABLED_BAR_SHELL =
  'px-3 py-1.5 border-chatroom-border bg-chatroom-bg-secondary flex items-center gap-2 h-full';

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

function NameInput(props: { value: string; onChange: (value: string) => void; mobile?: boolean }) {
  const { value, onChange, mobile } = props;
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Name (optional)"
      maxLength={120}
      className={`w-full bg-chatroom-bg-primary border border-chatroom-border placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent ${
        mobile ? 'px-3 py-2 text-sm' : 'px-2 py-1 text-xs'
      }`}
    />
  );
}

type AddSelection = HistoryItem['_id'] | 'create-new' | null;

function HistorySelectionList(props: {
  items: HistoryItem[];
  selection: AddSelection;
  onSelectHistory: (item: HistoryItem) => void;
}) {
  const { items, selection, onSelectHistory } = props;

  if (items.length === 0) return null;

  return (
    <ul className="flex w-full flex-col border border-chatroom-border divide-y divide-chatroom-border">
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
    </ul>
  );
}

function CreateNewButton(props: { selected: boolean; onSelect: () => void; mobile?: boolean }) {
  const { selected, onSelect, mobile } = props;

  const baseClasses =
    'w-full flex items-center justify-center gap-2 font-bold uppercase tracking-wider border-0 transition-colors cursor-pointer';
  const sizeClasses = mobile ? 'min-h-11 px-3 py-2 text-sm' : 'px-4 py-2 text-xs';
  const stateClasses = selected
    ? 'bg-chatroom-status-success/10 text-chatroom-accent'
    : 'bg-chatroom-status-success/5 text-chatroom-text-primary hover:bg-chatroom-status-success/10';

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="standing-instructions-create-new"
      className={`${baseClasses} ${sizeClasses} ${stateClasses}`}
    >
      <Plus size={mobile ? 14 : 12} className="shrink-0" aria-hidden="true" />
      <span>Create new</span>
    </button>
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
  draftName: string;
  onDraftChange: (value: string) => void;
  onDraftNameChange: (value: string) => void;
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
    draftName,
    onDraftChange,
    onDraftNameChange,
    onSelectHistory,
    onSelectCreateNew,
    onViewMore,
    onConfirm,
    onCancel,
    confirmDisabled,
  } = props;

  return (
    <div
      className={`${PANEL_CHROME} flex flex-col gap-1.5`}
      data-testid="standing-instructions-adding-panel"
    >
      <AddingPanelHeader onViewMore={onViewMore} />
      <HistorySelectionList
        items={historyTop3}
        selection={selection}
        onSelectHistory={onSelectHistory}
      />
      <CreateNewButton selected={selection === 'create-new'} onSelect={onSelectCreateNew} />
      {selection === 'create-new' ? (
        <>
          <NameInput value={draftName} onChange={onDraftNameChange} />
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => onStandingEditorKeyDown(e, onCancel, onConfirm)}
            placeholder="Enter standing instructions…"
            className="w-full bg-chatroom-bg-primary border border-chatroom-border px-2 py-1 text-xs text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent resize-none"
            rows={3}
          />
        </>
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
  draftName: string;
  onDraftChange: (value: string) => void;
  onDraftNameChange: (value: string) => void;
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
    draftName,
    onDraftChange,
    onDraftNameChange,
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
        <div
          className="flex flex-col gap-3 py-3"
          data-testid="standing-instructions-mobile-add-body"
        >
          <HistorySelectionList
            items={historyTop3}
            selection={selection}
            onSelectHistory={onSelectHistory}
          />
          <CreateNewButton
            selected={selection === 'create-new'}
            onSelect={onSelectCreateNew}
            mobile
          />
          {selection === 'create-new' ? (
            <>
              <NameInput value={draftName} onChange={onDraftNameChange} mobile />
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => onStandingEditorKeyDown(e, onCancel, onConfirm)}
                placeholder="Enter standing instructions…"
                rows={5}
                className="w-full min-h-[120px] bg-chatroom-bg-primary border border-chatroom-border px-3 py-3 text-sm text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent resize-none"
              />
            </>
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
  draftName: string;
  onDraftChange: (value: string) => void;
  onDraftNameChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { draft, draftName, onDraftChange, onDraftNameChange, onConfirm, onCancel } = props;
  return (
    <div
      className={`${PANEL_CHROME} flex flex-col gap-1.5`}
      data-testid="standing-instructions-editing-panel"
    >
      <NameInput value={draftName} onChange={onDraftNameChange} />
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
  draftName: string;
  onDraftChange: (value: string) => void;
  onDraftNameChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { open, draft, draftName, onDraftChange, onDraftNameChange, onConfirm, onCancel } = props;
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
          <NameInput value={draftName} onChange={onDraftNameChange} mobile />
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
  const queryResult = useSessionQuery(api.standingInstructions.get, { chatroomId });
  const storedContent = queryResult?.content ?? '';
  const storedName = queryResult?.name ?? '';
  const enabled = queryResult?.enabled ?? false;
  const isActive =
    getActiveStandingInstructions({
      standingInstructions: storedContent,
      standingInstructionsEnabled: enabled,
    }) !== null;
  const hasContent = storedContent.trim().length > 0;
  const displayText = storedName.trim() ? storedName.trim() : storedContent;

  const upsertMutation = useSessionMutation(api.standingInstructions.upsert);
  const setEnabledMutation = useSessionMutation(api.standingInstructions.setEnabled);
  const clearMutation = useSessionMutation(api.standingInstructions.clear);

  const history = useSessionQuery(api.standingInstructions.listHistory, {}) ?? [];
  const recordUseMutation = useSessionMutation(api.standingInstructions.recordUse);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitialView, setDialogInitialView] =
    useState<StandingInstructionsDialogInitialView>('add');

  const historyItems = useMemo(
    () =>
      history.map((item) => ({
        id: item._id,
        content: item.content,
        useCount: item.useCount,
        lastUsedAt: item.lastUsedAt,
      })),
    [history]
  );

  const openAddDialog = useCallback(() => {
    setDialogInitialView('add');
    setDialogOpen(true);
  }, []);

  const openActionsDialog = useCallback(() => {
    setDialogInitialView('actions');
    setDialogOpen(true);
  }, []);

  const handleDialogConfirm = useCallback(
    async ({ content, name }: { content: string; name: string }) => {
      await upsertMutation({ chatroomId, content, name });
    },
    [chatroomId, upsertMutation]
  );

  const handleRecordHistoryUse = useCallback(
    async (historyId: string) => {
      const result = await recordUseMutation({
        historyId: historyId as Id<'chatroom_standingInstructionHistory'>,
      });
      return { content: result.content };
    },
    [recordUseMutation]
  );

  const handleEnable = useCallback(async () => {
    await setEnabledMutation({ chatroomId, enabled: true });
  }, [chatroomId, setEnabledMutation]);

  const handleDisable = useCallback(async () => {
    await setEnabledMutation({ chatroomId, enabled: false });
  }, [chatroomId, setEnabledMutation]);

  const handleDelete = useCallback(async () => {
    await clearMutation({ chatroomId });
  }, [chatroomId, clearMutation]);

  const dialog = (
    <StandingInstructionsDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      initialView={dialogInitialView}
      storedContent={storedContent}
      storedName={storedName}
      isActive={isActive}
      history={historyItems}
      onConfirm={handleDialogConfirm}
      onEnable={handleEnable}
      onDisable={handleDisable}
      onDelete={handleDelete}
      onRecordHistoryUse={handleRecordHistoryUse}
    />
  );

  if (!hasContent) {
    return (
      <>
        <button
          type="button"
          aria-label="Add standing instructions"
          onClick={openAddDialog}
          className={`${BAR_SHELL} w-full text-left hover:bg-chatroom-status-success/10 transition-colors cursor-pointer`}
        >
          <Plus
            size={mobileIconSize(isDesktop)}
            className="shrink-0 text-chatroom-status-success"
          />
          <span
            className={`${mobileLabelText(isDesktop)} font-bold uppercase tracking-wider text-chatroom-status-success hidden sm:inline`}
          >
            Add standing instructions
          </span>
        </button>
        {dialog}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={isActive ? 'Standing instructions' : 'Standing instructions (disabled)'}
        onClick={openActionsDialog}
        className={`${isActive ? BAR_SHELL : DISABLED_BAR_SHELL} w-full text-left cursor-pointer transition-colors ${isActive ? 'hover:bg-chatroom-status-success/10' : 'hover:bg-chatroom-bg-hover'}`}
      >
        <BookOpen
          size={mobileIconSize(isDesktop)}
          className={`shrink-0 ${isActive ? 'text-chatroom-status-success' : 'text-chatroom-text-muted'}`}
        />
        <span
          className={`${mobileLabelText(isDesktop)} font-bold uppercase tracking-wider shrink-0 hidden sm:inline ${isActive ? 'text-chatroom-status-success' : 'text-chatroom-text-muted'}`}
        >
          Standing instructions{isActive ? '' : ' (disabled)'}
        </span>
        <span className="text-xs text-chatroom-text-secondary truncate flex-1">
          {displayText}
          {!isActive ? (
            <span className="sm:hidden text-chatroom-text-muted shrink-0"> (off)</span>
          ) : null}
        </span>
      </button>
      {dialog}
    </>
  );
});

// Keep dead refs for Slice 3 removal — these are the inline panels being replaced
void AddingPanel;
void MobileAddingDrawer;
void HistoryFullPicker;
void EditingPanel;
void MobileEditingDrawer;
