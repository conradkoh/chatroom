'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import {
  getActiveStandingInstructions,
  standingInstructionDisplayTitle,
} from '@workspace/backend/src/domain/entities/standing-instructions';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { BookOpen, Plus } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';

import { ResponsivePickerShell } from '../components/picker';
import {
  StandingInstructionsDialog,
  StandingInstructionsPresetDeleteConfirmDialog,
  StandingInstructionsSharedEditConfirmDialog,
} from '../features/standing-instructions/components';
import { StandingInstructionsActionsView } from '../features/standing-instructions/components/StandingInstructionsActionsView';

import { useIsDesktop } from '@/hooks/useIsDesktop';

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

const BAR_SHELL = `${BAR_ROW_CHROME} flex items-center gap-2 h-full`;

const DISABLED_BAR_SHELL =
  'px-3 py-1.5 border-chatroom-border bg-chatroom-bg-secondary flex items-center gap-2 h-full';

// fallow-ignore-next-line complexity
export const StandingInstructionsBar = memo(function StandingInstructionsBar({
  chatroomId,
}: StandingInstructionsBarProps) {
  const isDesktop = useIsDesktop();
  const queryResult = useSessionQuery(api.standingInstructions.get, { chatroomId });
  const isLoading = queryResult === undefined;
  const storedContent = queryResult?.content ?? '';
  const storedTitle = queryResult?.title ?? '';
  const presetId = queryResult?.presetId;
  const enabled = queryResult?.enabled ?? false;
  const isActive =
    getActiveStandingInstructions({
      standingInstructions: storedContent,
      standingInstructionsEnabled: enabled,
    }) !== null;
  const hasContent = storedContent.trim().length > 0;
  const displayText = standingInstructionDisplayTitle({
    title: storedTitle,
    content: storedContent,
  });

  const upsertMutation = useSessionMutation(api.standingInstructions.upsert);
  const updatePresetMutation = useSessionMutation(api.standingInstructions.updatePreset);
  const deletePresetMutation = useSessionMutation(api.standingInstructions.deletePreset);
  const setEnabledMutation = useSessionMutation(api.standingInstructions.setEnabled);
  const clearMutation = useSessionMutation(api.standingInstructions.clear);

  const history = useSessionQuery(api.standingInstructions.listHistory, {}) ?? [];
  const recordUseMutation = useSessionMutation(api.standingInstructions.recordUse);

  const [actionsOpen, setActionsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [sharedEditConfirmOpen, setSharedEditConfirmOpen] = useState(false);
  const [pendingEditPayload, setPendingEditPayload] = useState<{
    content: string;
    title: string;
  } | null>(null);
  const [presetDeleteId, setPresetDeleteId] =
    useState<Id<'chatroom_standingInstructionHistory'> | null>(null);

  // Used to decide whether editing the linked preset needs the shared-edit
  // confirmation (usage > 1) versus a direct single-room update.
  const presetUsage = useSessionQuery(
    api.standingInstructions.getPresetUsage,
    presetId && editOpen ? { presetId } : 'skip'
  );

  const historyItems = useMemo(
    () =>
      history.map((item) => ({
        id: item._id,
        content: item.content,
        title: item.title,
        useCount: item.useCount,
        lastUsedAt: item.lastUsedAt,
      })),
    [history]
  );

  const handleDialogConfirm = useCallback(
    async ({ content, title }: { content: string; title: string }) => {
      if (presetId) {
        // Editing a linked preset — shared edit requires confirmation when the
        // preset is used in more than one chatroom.
        if (presetUsage && presetUsage.totalCount > 1) {
          setPendingEditPayload({ content, title });
          setSharedEditConfirmOpen(true);
          return;
        }
        await updatePresetMutation({ presetId, content, title });
      } else {
        await upsertMutation({ chatroomId, content, title });
      }
    },
    [chatroomId, presetId, presetUsage, upsertMutation, updatePresetMutation]
  );

  const handleSharedEditConfirmed = useCallback(async () => {
    if (pendingEditPayload && presetId) {
      await updatePresetMutation({ presetId, ...pendingEditPayload });
    }
    setPendingEditPayload(null);
    setSharedEditConfirmOpen(false);
  }, [pendingEditPayload, presetId, updatePresetMutation]);

  const handleDeletePreset = useCallback((historyId: string) => {
    setPresetDeleteId(historyId as Id<'chatroom_standingInstructionHistory'>);
  }, []);

  const handlePresetDeleteConfirmed = useCallback(async () => {
    if (presetDeleteId) {
      await deletePresetMutation({ presetId: presetDeleteId });
    }
    setPresetDeleteId(null);
  }, [presetDeleteId, deletePresetMutation]);

  const handleRecordHistoryUse = useCallback(
    async (historyId: string) => {
      const result = await recordUseMutation({
        historyId: historyId as Id<'chatroom_standingInstructionHistory'>,
      });
      return { content: result.content, title: result.title };
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

  if (isLoading) {
    return (
      <div
        className={`${BAR_SHELL} w-full opacity-50`}
        aria-busy="true"
        aria-label="Loading standing instructions"
        data-testid="standing-instructions-bar-loading"
      >
        <BookOpen
          size={mobileIconSize(isDesktop)}
          className="shrink-0 text-chatroom-text-muted animate-pulse"
        />
        <span
          className={`${mobileLabelText(isDesktop)} font-bold uppercase tracking-wider shrink-0 hidden sm:inline text-chatroom-text-muted`}
        >
          Standing instructions
        </span>
        <span
          className="flex-1 h-3 max-w-[8rem] bg-chatroom-border/50 animate-pulse"
          aria-hidden="true"
        />
      </div>
    );
  }

  const addDialog = addOpen ? (
    <StandingInstructionsDialog
      open
      onOpenChange={setAddOpen}
      initialView="add"
      storedContent={storedContent}
      storedTitle={storedTitle}
      history={historyItems}
      onConfirm={handleDialogConfirm}
      onRecordHistoryUse={handleRecordHistoryUse}
      onDeletePreset={handleDeletePreset}
    />
  ) : null;

  const editDialog = editOpen ? (
    <StandingInstructionsDialog
      open
      onOpenChange={(open) => {
        if (!open) setEditOpen(false);
      }}
      initialView="edit"
      storedContent={storedContent}
      storedTitle={storedTitle}
      history={historyItems}
      onConfirm={handleDialogConfirm}
      onRecordHistoryUse={handleRecordHistoryUse}
      onDeletePreset={handleDeletePreset}
    />
  ) : null;

  const sharedEditConfirmDialog =
    sharedEditConfirmOpen && presetId && pendingEditPayload ? (
      <StandingInstructionsSharedEditConfirmDialog
        open
        onOpenChange={(open) => {
          if (!open) {
            setSharedEditConfirmOpen(false);
            setPendingEditPayload(null);
          }
        }}
        presetId={presetId}
        onConfirmed={handleSharedEditConfirmed}
      />
    ) : null;

  const presetDeleteConfirmDialog = presetDeleteId ? (
    <StandingInstructionsPresetDeleteConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) setPresetDeleteId(null);
      }}
      presetId={presetDeleteId}
      onConfirmed={handlePresetDeleteConfirmed}
    />
  ) : null;

  if (!hasContent) {
    return (
      <>
        <button
          type="button"
          data-testid="standing-instructions-add-bar"
          aria-label="Add standing instructions"
          onClick={() => setAddOpen(true)}
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
        {addDialog}
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
            data-testid={
              isActive ? 'standing-instructions-active-bar' : 'standing-instructions-disabled-bar'
            }
            aria-label={isActive ? 'Standing instructions' : 'Standing instructions (disabled)'}
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
        }
      >
        <StandingInstructionsActionsView
          isActive={isActive}
          mobile={!isDesktop}
          onEdit={() => {
            setActionsOpen(false);
            setEditOpen(true);
          }}
          onEnable={async () => {
            await handleEnable();
            setActionsOpen(false);
          }}
          onDisable={async () => {
            await handleDisable();
            setActionsOpen(false);
          }}
          onDelete={async () => {
            await handleDelete();
            setActionsOpen(false);
          }}
        />
      </ResponsivePickerShell>
      {editDialog}
      {sharedEditConfirmDialog}
      {presetDeleteConfirmDialog}
    </>
  );
});
