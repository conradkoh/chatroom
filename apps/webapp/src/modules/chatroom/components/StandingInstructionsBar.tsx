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

import { StandingInstructionsDialog } from '../features/standing-instructions/components';
import type { StandingInstructionsDialogInitialView } from '../features/standing-instructions/types/standingInstructionsDialog';

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

export const StandingInstructionsBar = memo(function StandingInstructionsBar({
  chatroomId,
}: StandingInstructionsBarProps) {
  const isDesktop = useIsDesktop();
  const queryResult = useSessionQuery(api.standingInstructions.get, { chatroomId });
  const isLoading = queryResult === undefined;
  const storedContent = queryResult?.content ?? '';
  const storedTitle = queryResult?.title ?? '';
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
        title: item.title,
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
    async ({ content, title }: { content: string; title: string }) => {
      await upsertMutation({ chatroomId, content, title });
    },
    [chatroomId, upsertMutation]
  );

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

  const dialog = dialogOpen ? (
    <StandingInstructionsDialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setDialogOpen(false);
      }}
      initialView={dialogInitialView}
      storedContent={storedContent}
      storedTitle={storedTitle}
      isActive={isActive}
      history={historyItems}
      onConfirm={handleDialogConfirm}
      onEnable={handleEnable}
      onDisable={handleDisable}
      onDelete={handleDelete}
      onRecordHistoryUse={handleRecordHistoryUse}
    />
  ) : null;

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
