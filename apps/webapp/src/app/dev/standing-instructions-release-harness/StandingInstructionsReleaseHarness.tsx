'use client';

import { BookOpen, Plus } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportKeyboardInset } from '@/hooks/useMobileKeyboard';
import {
  PickerOptionRow,
  PickerPanelHeader,
  PickerScrollBody,
  PickerSearch,
  ResponsivePickerShell,
  filterPickerItems,
  getMobileDrawerContentStyle,
  usePickerSearchState,
} from '@/modules/chatroom/components/picker';
import { MOBILE_DRAWER_CONTENT_CLASSNAME } from '@/modules/chatroom/components/picker/mobileDrawerLayout';
import { useOverlayPortalContainer } from '@/modules/chatroom/components/shared/overlayPortalContainer';

type HistoryItem = {
  _id: string;
  content: string;
  useCount: number;
  lastUsedAt: number;
};

const BAR_CHROME_BASE =
  'px-3 border-b border-chatroom-status-success/15 bg-chatroom-status-success/5';

const BAR_ROW_CHROME = `${BAR_CHROME_BASE} py-1.5`;

const PANEL_CHROME = `${BAR_CHROME_BASE} py-1.5`;

const BAR_SHELL = `${BAR_ROW_CHROME} flex items-center gap-2`;

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
  if (e.key !== 'Enter') return;
  if (!e.metaKey && !e.ctrlKey) return;
  e.preventDefault();
  onConfirm();
}

const FAKE_HISTORY: HistoryItem[] = [
  { _id: 'h1', content: 'Always use TypeScript with strict mode', useCount: 12, lastUsedAt: 5000 },
  { _id: 'h2', content: 'Write unit tests before submitting PRs', useCount: 8, lastUsedAt: 4000 },
  { _id: 'h3', content: 'Use async/await instead of raw promises', useCount: 5, lastUsedAt: 3000 },
  { _id: 'h4', content: 'Document public APIs with JSDoc comments', useCount: 3, lastUsedAt: 2000 },
];

type AddSelection = string | 'create-new' | null;

function HistorySelectionList(props: {
  items: HistoryItem[];
  selection: AddSelection;
  onSelectHistory: (item: HistoryItem) => void;
  onSelectCreateNew: () => void;
}) {
  const { items, selection, onSelectHistory, onSelectCreateNew } = props;
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
        data-testid="standing-instructions-harness-view-more"
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
    <div className={`${PANEL_CHROME} flex flex-col gap-1.5`}>
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
    <div className={`${PANEL_CHROME} flex flex-col gap-1.5`}>
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
            data-testid="standing-instructions-harness-view-more"
            className="text-[10px] font-bold uppercase tracking-wider text-chatroom-accent hover:opacity-80 cursor-pointer shrink-0"
          >
            View more
          </button>
        </PickerPanelHeader>
        <div className="flex flex-col gap-3 py-3">
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

export function StandingInstructionsReleaseHarness() {
  const isDesktop = useIsDesktop();
  const actionRowClassName = isDesktop ? undefined : 'min-h-11 py-3 text-sm';
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [addSelection, setAddSelection] = useState<AddSelection>(null);
  const [draft, setDraft] = useState('');
  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const handleConfirm = () => {
    setEditing(false);
    setIsAdding(false);
    setAddSelection(null);
    setLastAction(`confirmed: ${draft}`);
  };

  const handleCancel = () => {
    setDraft('');
    setEditing(false);
    setIsAdding(false);
    setAddSelection(null);
  };

  const startEditing = () => {
    setDraft('Always use TypeScript');
    setActionsOpen(false);
    setIsAdding(false);
    setEditing(true);
  };

  const handleSelectHistory = (item: HistoryItem) => {
    setDraft(item.content);
    setAddSelection(item._id);
    setHistoryPickerOpen(false);
  };

  const handleSelectCreateNew = () => {
    setAddSelection('create-new');
    setDraft('');
  };

  const labelText = isDesktop ? 'text-[10px]' : 'text-xs';
  const iconSize = isDesktop ? 12 : 14;
  const historyTop3 = FAKE_HISTORY.slice(0, 3);

  const confirmDisabled =
    addSelection === null || (addSelection === 'create-new' && draft.trim().length === 0);

  const addingPanelProps = {
    historyTop3,
    selection: addSelection,
    draft,
    onDraftChange: setDraft,
    onSelectHistory: handleSelectHistory,
    onSelectCreateNew: handleSelectCreateNew,
    onViewMore: () => setHistoryPickerOpen(true),
    onConfirm: handleConfirm,
    onCancel: handleCancel,
    confirmDisabled,
  };

  const editorHandlers = {
    draft,
    onDraftChange: setDraft,
    onConfirm: handleConfirm,
    onCancel: handleCancel,
  };

  const historyFullPicker = isAdding ? (
    <HistoryFullPicker
      open={historyPickerOpen}
      onOpenChange={setHistoryPickerOpen}
      items={FAKE_HISTORY}
      onSelect={handleSelectHistory}
    />
  ) : null;

  return (
    <div
      className="flex flex-col gap-6 p-6 max-w-2xl mx-auto"
      data-testid="standing-instructions-harness-root"
    >
      <h1 className="text-sm font-bold uppercase tracking-wider">
        Standing Instructions Release Harness
      </h1>
      <p className="text-[10px] text-chatroom-text-muted">
        Temporary no-auth harness for verifying standing-instructions UX. No Convex backend.
      </p>

      {/* Debug strip */}
      <div className="text-[10px] font-mono text-chatroom-text-secondary flex gap-4 flex-wrap">
        {lastAction ? <span>Last action: {lastAction}</span> : null}
        <span>Viewport: {isDesktop ? 'desktop' : 'mobile'}</span>
      </div>

      {/* Section A — click-anchor bar */}
      <section data-testid="standing-instructions-harness-active-bar-section">
        <h2 className="text-[10px] font-bold uppercase tracking-wider mb-2">
          Active bar (anchorToPointer)
        </h2>
        <ResponsivePickerShell
          open={actionsOpen}
          onOpenChange={setActionsOpen}
          title="Standing instructions"
          anchorToPointer
          contentClassName="w-56 p-0"
          trigger={
            <button
              type="button"
              data-testid="standing-instructions-harness-active-bar"
              className={`${BAR_SHELL} w-full text-left`}
            >
              <BookOpen size={iconSize} className="shrink-0 text-chatroom-status-success" />
              <span
                className={`${labelText} font-bold uppercase tracking-wider text-chatroom-status-success`}
              >
                Standing instructions
              </span>
              <span className="text-xs text-chatroom-text-secondary truncate flex-1">
                Always use TypeScript
              </span>
            </button>
          }
        >
          <PickerPanelHeader title="Standing instructions" />
          <PickerScrollBody>
            <PickerOptionRow
              selected={false}
              className={actionRowClassName}
              onSelect={startEditing}
            >
              Edit
            </PickerOptionRow>
            <PickerOptionRow
              selected={false}
              className={actionRowClassName}
              onSelect={() => {
                setLastAction('disable');
                setActionsOpen(false);
              }}
            >
              Disable
            </PickerOptionRow>
            <PickerOptionRow
              selected={false}
              className={actionRowClassName}
              onSelect={() => {
                setLastAction('delete');
                setActionsOpen(false);
              }}
            >
              <span className="text-destructive">Delete</span>
            </PickerOptionRow>
          </PickerScrollBody>
        </ResponsivePickerShell>
      </section>

      {/* Section B — Add with history */}
      <section data-testid="standing-instructions-harness-add-section">
        <h2 className="text-[10px] font-bold uppercase tracking-wider mb-2">Add with history</h2>
        {editing && isDesktop && isAdding ? (
          <>
            <AddingPanel {...addingPanelProps} />
            {historyFullPicker}
          </>
        ) : null}
        {editing && !isDesktop && isAdding ? (
          <>
            <MobileAddingDrawer open={editing} {...addingPanelProps} />
            {historyFullPicker}
          </>
        ) : null}
        {!editing ? (
          <button
            type="button"
            data-testid="standing-instructions-harness-add"
            className={`${BAR_SHELL} w-full text-left hover:bg-chatroom-status-success/10 transition-colors cursor-pointer`}
            onClick={() => {
              setDraft('');
              setAddSelection(null);
              setIsAdding(true);
              setEditing(true);
            }}
          >
            <Plus size={iconSize} className="shrink-0 text-chatroom-status-success" />
            <span
              className={`${labelText} font-bold uppercase tracking-wider text-chatroom-status-success`}
            >
              Add standing instructions
            </span>
          </button>
        ) : null}
      </section>

      {/* Section C — Edit without history */}
      <section data-testid="standing-instructions-harness-edit-section">
        <h2 className="text-[10px] font-bold uppercase tracking-wider mb-2">Edit (no history)</h2>
        {editing && isDesktop && !isAdding ? <EditingPanel {...editorHandlers} /> : null}
        {editing && !isDesktop && !isAdding ? (
          <MobileEditingDrawer open={editing} {...editorHandlers} />
        ) : null}
        {!editing ? (
          <button
            type="button"
            data-testid="standing-instructions-harness-edit"
            className={`${BAR_SHELL} w-full text-left hover:bg-chatroom-status-success/10 transition-colors cursor-pointer`}
            onClick={() => {
              setDraft('Always use TypeScript');
              setIsAdding(false);
              setEditing(true);
            }}
          >
            <BookOpen size={iconSize} className="shrink-0 text-chatroom-status-success" />
            <span
              className={`${labelText} font-bold uppercase tracking-wider text-chatroom-status-success`}
            >
              Edit existing
            </span>
          </button>
        ) : null}
      </section>
    </div>
  );
}
