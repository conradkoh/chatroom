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
  ResponsivePickerShell,
  getMobileDrawerContentStyle,
} from './picker';
import { MOBILE_DRAWER_CONTENT_CLASSNAME } from './picker/mobileDrawerLayout';
import { useOverlayPortalContainer } from './shared/overlayPortalContainer';

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportKeyboardInset } from '@/hooks/useMobileKeyboard';

interface StandingInstructionsBarProps {
  chatroomId: Id<'chatroom_rooms'>;
}

function mobileBarMinH(isDesktop: boolean): string {
  return isDesktop ? 'min-h-9' : 'min-h-11';
}

function mobileLabelText(isDesktop: boolean): string {
  return isDesktop ? 'text-[10px]' : 'text-xs';
}

function mobileIconSize(isDesktop: boolean): number {
  return isDesktop ? 12 : 14;
}

const BAR_CHROME =
  'px-3 py-1.5 border-b border-chatroom-status-success/15 bg-chatroom-status-success/5';

const BAR_SHELL = `${BAR_CHROME} flex items-center gap-2`;

const DISABLED_BAR_SHELL =
  'px-3 py-1.5 border-b border-chatroom-border bg-chatroom-bg-secondary flex items-center gap-2';

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

  const handleEnable = useCallback(async () => {
    setActionsOpen(false);
    await setEnabledMutation({ chatroomId, enabled: true });
  }, [chatroomId, setEnabledMutation]);

  const handleDelete = useCallback(async () => {
    setActionsOpen(false);
    await clearMutation({ chatroomId });
    setDraft('');
    setEditing(false);
  }, [chatroomId, clearMutation]);

  const editorHandlers = {
    draft,
    onDraftChange: setDraft,
    onConfirm: () => {
      void handleConfirm();
    },
    onCancel: handleCancel,
  };

  if (editing && isDesktop) {
    return <EditingPanel {...editorHandlers} />;
  }

  const mobileEditor =
    editing && !isDesktop ? <MobileEditingDrawer open={editing} {...editorHandlers} /> : null;

  if (!hasContent) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setDraft('');
            setEditing(true);
          }}
          className={`${mobileBarMinH(isDesktop)} ${BAR_SHELL} w-full text-left hover:bg-chatroom-status-success/10 transition-colors cursor-pointer`}
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
        {mobileEditor}
      </>
    );
  }

  return (
    <>
      <ResponsivePickerShell
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title="Standing instructions"
        align="start"
        contentClassName="w-56 p-0"
        trigger={
          <button
            type="button"
            className={`${mobileBarMinH(isDesktop)} ${isActive ? BAR_SHELL : DISABLED_BAR_SHELL} w-full text-left cursor-pointer transition-colors ${isActive ? 'hover:bg-chatroom-status-success/10' : 'hover:bg-chatroom-bg-hover'}`}
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
      {mobileEditor}
    </>
  );
});
