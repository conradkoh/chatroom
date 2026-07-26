'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Loader2, Power, PowerOff, Trash2 } from 'lucide-react';
import React, { useCallback, useRef, useState } from 'react';

import { formatSchedule, formatTime } from '../utils/scheduledPromptFormat';
import { ScheduledPromptDetailDialog } from './ScheduledPromptDetailDialog';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer';
import { Switch } from '@/components/ui/switch';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useOverlayDismissStack } from '../../../hooks/useOverlayDismissStack';
import { useOverlayPortalContainer } from '../../../components/shared/overlayPortalContainer';
import { Popover, PopoverAnchor, PopoverContent } from '../../../components/ui/popover';

interface ScheduledPromptCardProps {
  prompt: {
    _id: Id<'chatroom_scheduledPrompts'>;
    name?: string;
    prompt: string;
    scheduleKind: 'interval' | 'daily';
    intervalMinutes?: number;
    hourUTC?: number;
    minuteUTC?: number;
    disabledReason?: 'archive' | 'user';
    lastRunAt?: number;
    nextRunAt?: number;
  };
  onEdit: (id: Id<'chatroom_scheduledPrompts'>) => void;
  setEnabled: (args: {
    scheduledPromptId: Id<'chatroom_scheduledPrompts'>;
    enabled: boolean;
  }) => Promise<unknown>;
  removePrompt: (args: { scheduledPromptId: Id<'chatroom_scheduledPrompts'> }) => Promise<unknown>;
}

export function ActionsMenuContent({
  showDeleteConfirm,
  setShowDeleteConfirm,
  onEdit,
  onDelete,
  isDeleting,
  isArchiveDisabled,
  onClose,
}: {
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (v: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  isArchiveDisabled: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs justify-start"
        onClick={() => {
          onEdit();
          onClose();
        }}
      >
        Edit
      </Button>
      {showDeleteConfirm ? (
        <div className="flex gap-2">
          <Button
            variant="destructive"
            size="sm"
            className="flex-1 text-xs"
            onClick={onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? <Loader2 size={12} className="animate-spin" /> : 'Confirm Delete'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 text-xs"
            onClick={() => setShowDeleteConfirm(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs justify-start text-red-500 hover:text-red-400"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={isArchiveDisabled}
        >
          <Trash2 size={12} className="mr-2" />
          Delete
        </Button>
      )}
    </>
  );
}

export function ScheduledPromptCard({
  prompt,
  onEdit,
  setEnabled,
  removePrompt,
}: ScheduledPromptCardProps) {
  const [isToggling, setIsToggling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isArchiveDisabled = prompt.disabledReason === 'archive';
  const isActive = prompt.disabledReason === undefined;
  const isDesktop = useIsDesktop();
  const portalContainer = useOverlayPortalContainer();
  const cardRef = useRef<HTMLDivElement>(null);

  useOverlayDismissStack(!isDesktop && actionsOpen, () => setActionsOpen(false));

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await removePrompt({ scheduledPromptId: prompt._id });
      setActionsOpen(false);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [prompt._id, removePrompt]);

  const handleCardTap = useCallback(() => {
    if (!isArchiveDisabled) setActionsOpen(true);
  }, [isArchiveDisabled]);

  const handleHistoryClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDetailOpen(true);
  }, []);

  const displayName =
    prompt.name || prompt.prompt.slice(0, 60) + (prompt.prompt.length > 60 ? '...' : '');

  const editHandler = useCallback(() => {
    onEdit(prompt._id);
  }, [onEdit, prompt._id]);

  const menuContent = (
    <ActionsMenuContent
      showDeleteConfirm={showDeleteConfirm}
      setShowDeleteConfirm={setShowDeleteConfirm}
      onEdit={editHandler}
      onDelete={handleDelete}
      isDeleting={isDeleting}
      isArchiveDisabled={isArchiveDisabled}
      onClose={() => setActionsOpen(false)}
    />
  );

  return (
    <>
      <div
        ref={cardRef}
        className="border border-chatroom-border rounded-none p-4 bg-chatroom-bg-secondary overflow-hidden min-w-0 cursor-pointer hover:bg-chatroom-bg-hover transition-colors"
        onClick={handleCardTap}
        role="button"
        tabIndex={0}
        data-testid="scheduled-prompt-card"
      >
        <div className="flex items-start justify-between gap-3 min-w-0">
          <span className="text-sm font-bold text-chatroom-text-primary truncate min-w-0 flex-1">
            {displayName}
          </span>
          <span
            className={`inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-none text-[10px] font-bold uppercase tracking-wider ${
              isActive
                ? 'bg-green-500/10 text-green-500 dark:bg-green-500/20 dark:text-green-400'
                : isArchiveDisabled
                  ? 'bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400'
                  : 'bg-chatroom-bg-tertiary text-chatroom-text-muted'
            }`}
          >
            {isActive ? (
              <>
                <Power size={10} />
                Active
              </>
            ) : isArchiveDisabled ? (
              'Disabled by archive'
            ) : (
              <>
                <PowerOff size={10} />
                Disabled
              </>
            )}
          </span>
        </div>

        <p className="text-xs text-chatroom-text-primary truncate mt-2">{prompt.prompt}</p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 min-w-0">
          <span className="text-[11px] text-chatroom-text-muted break-words">
            {formatSchedule(prompt)}
          </span>
          {prompt.lastRunAt && (
            <span className="text-[11px] text-chatroom-text-muted break-words">
              Last run: {formatTime(prompt.lastRunAt)}
            </span>
          )}
          {prompt.nextRunAt && isActive && (
            <span className="text-[11px] text-chatroom-text-muted break-words">
              Next run: {formatTime(prompt.nextRunAt)}
            </span>
          )}
        </div>

        <div className="flex items-end justify-between mt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleHistoryClick}
            className="text-[10px] h-6 px-2 text-chatroom-text-muted hover:text-chatroom-accent"
          >
            View trigger history
          </Button>
          <Switch
            checked={isActive}
            onCheckedChange={(checked) => {
              if (checked === isActive) return;
              setIsToggling(true);
              setEnabled({ scheduledPromptId: prompt._id, enabled: checked }).finally(() =>
                setIsToggling(false)
              );
            }}
            disabled={isToggling || isArchiveDisabled}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          />
        </div>
      </div>

      {isDesktop ? (
        <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
          <PopoverAnchor virtualRef={cardRef as any} />
          <PopoverContent
            side="bottom"
            align="end"
            className="w-56 p-2 rounded-none border-chatroom-border bg-chatroom-bg-secondary"
            onOpenAutoFocus={(e: Event) => e.preventDefault()}
          >
            <div className="space-y-2">{menuContent}</div>
          </PopoverContent>
        </Popover>
      ) : (
        <Drawer
          open={actionsOpen}
          onOpenChange={setActionsOpen}
          nested
          repositionInputs={false}
          container={portalContainer ?? undefined}
        >
          <DrawerContent className="rounded-none border-chatroom-border bg-chatroom-bg-secondary">
            <DrawerHeader>
              <DrawerTitle className="text-sm font-bold text-chatroom-text-primary">
                {displayName}
              </DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-4 space-y-2">{menuContent}</div>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button variant="ghost" size="sm" className="w-full text-xs">
                  Cancel
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )}

      {detailOpen && (
        <ScheduledPromptDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          scheduledPromptId={prompt._id}
        />
      )}
    </>
  );
}
