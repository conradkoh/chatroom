'use client';

import { standingInstructionDisplayTitle } from '@workspace/backend/src/domain/entities/standing-instructions';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { StandingInstructionsCreateModal } from './StandingInstructionsCreateModal';
import { StandingInstructionsDeleteConfirm } from './StandingInstructionsDeleteConfirm';
import { StandingInstructionsEditModal } from './StandingInstructionsEditModal';
import { StandingInstructionsHistoryModal } from './StandingInstructionsHistoryModal';
import { StandingInstructionsPickerContent } from './StandingInstructionsPickerContent';
import { StandingInstructionsPickerFooter } from './StandingInstructionsPickerFooter';
import {
  buildStandingInstructionsPickerList,
  isSyntheticCurrentItem,
  type PickerListItem,
} from './standingInstructionsPickerUtils';
import {
  getMobileDrawerContentStyle,
  MOBILE_DRAWER_CONTENT_CLASSNAME,
} from '../../../components/picker';
import { chatroomIndustrialDialogTitleClassName } from '../../../components/shared/industrialDialogStyles';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import {
  useVisualViewportKeyboardInset,
  useVisualViewportOffsetTop,
} from '@/hooks/useMobileKeyboard';
import { cn } from '@/lib/utils';

export interface StandingInstructionsPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storedContent: string;
  storedTitle: string;
  isActive: boolean;
  hasContent: boolean;
  history: StandingInstructionHistoryItem[];
  onConfirm: (payload: { content: string; title: string }) => void | Promise<void>;
  onEnable: () => void | Promise<void>;
  onDisable: () => void | Promise<void>;
  onEditItem: (
    item: PickerListItem,
    payload: { content: string; title: string; applyToAllChatrooms?: boolean }
  ) => void | Promise<void>;
  onDeleteItem: (item: PickerListItem) => void | Promise<void>;
}

// fallow-ignore-next-line complexity
export function StandingInstructionsPicker({
  open,
  onOpenChange,
  storedContent,
  storedTitle,
  isActive,
  hasContent,
  history,
  onConfirm,
  onEnable,
  onDisable,
  onEditItem,
  onDeleteItem,
}: StandingInstructionsPickerProps) {
  const isDesktop = useIsDesktop();
  const mobileActive = open && !isDesktop;
  const keyboardInsetPx = useVisualViewportKeyboardInset(mobileActive);
  const viewportOffsetTopPx = useVisualViewportOffsetTop(mobileActive);

  const { visible, activeId, hasMore } = buildStandingInstructionsPickerList({
    history,
    storedContent,
    storedTitle,
    isActive,
  });

  const [selectedId, setSelectedId] = useState<string | null>(activeId);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PickerListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PickerListItem | null>(null);

  const resolveSelectedItem = useCallback(
    (id: string | null): PickerListItem | undefined => {
      if (!id) return undefined;
      const fromVisible = visible.find((item) => item.id === id);
      if (fromVisible) return fromVisible;
      return history.find((item) => item.id === id);
    },
    [visible, history]
  );

  const handleApplySelection = useCallback(
    async (item: PickerListItem) => {
      const title = standingInstructionDisplayTitle({ title: item.title, content: item.content });
      await onConfirm({ content: item.content, title });
      onOpenChange(false);
    },
    [onConfirm, onOpenChange]
  );

  const handleFooterApply = useCallback(async () => {
    const item = resolveSelectedItem(selectedId);
    if (item) await handleApplySelection(item);
  }, [resolveSelectedItem, selectedId, handleApplySelection]);

  const handleDisable = useCallback(async () => {
    await onDisable();
    onOpenChange(false);
  }, [onDisable, onOpenChange]);

  const handleEnable = useCallback(async () => {
    await onEnable();
    onOpenChange(false);
  }, [onEnable, onOpenChange]);

  const handleHistorySelect = useCallback((item: StandingInstructionHistoryItem) => {
    setSelectedId(item.id);
    setHistoryModalOpen(false);
  }, []);

  // fallow-ignore-next-line complexity
  const handleEditSave = useCallback(
    async (payload: { content: string; title: string; applyToAllChatrooms?: boolean }) => {
      if (!editTarget) return;
      try {
        await onEditItem(editTarget, payload);
        setEditTarget(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        toast.error(
          message.includes('CONFLICT') || message.includes('already exists')
            ? 'Another standing instruction with this content already exists.'
            : 'Failed to update standing instruction. Please try again.'
        );
        throw error;
      }
    },
    [editTarget, onEditItem]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await onDeleteItem(deleteTarget);
      if (selectedId === deleteTarget.id) setSelectedId(activeId);
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to delete standing instruction. Please try again.');
    }
  }, [deleteTarget, onDeleteItem, selectedId, activeId]);

  const viewMoreButton = hasMore ? (
    <button
      type="button"
      onClick={() => setHistoryModalOpen(true)}
      data-testid="standing-instructions-view-more"
      className="text-xs font-bold uppercase tracking-wider text-chatroom-accent hover:opacity-80 cursor-pointer shrink-0"
    >
      View more
    </button>
  ) : null;

  const content = (
    <>
      <StandingInstructionsPickerContent
        visible={visible}
        activeId={activeId}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreateNew={() => setCreateModalOpen(true)}
        onEditItem={setEditTarget}
        onDeleteItem={setDeleteTarget}
        mobile={!isDesktop}
      />
      <StandingInstructionsPickerFooter
        isActive={isActive}
        hasContent={hasContent}
        selectedId={selectedId}
        activeId={activeId}
        onDisable={handleDisable}
        onEnable={handleEnable}
        onApply={handleFooterApply}
      />
      <StandingInstructionsHistoryModal
        open={historyModalOpen}
        onOpenChange={setHistoryModalOpen}
        history={history}
        onSelect={handleHistorySelect}
        onEditItem={setEditTarget}
        onDeleteItem={setDeleteTarget}
        mobile={!isDesktop}
      />
      <StandingInstructionsCreateModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onConfirm={async (payload) => {
          await onConfirm(payload);
          onOpenChange(false);
        }}
      />
      <StandingInstructionsEditModal
        key={editTarget?.id ?? 'none'}
        open={editTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setEditTarget(null);
        }}
        initialTitle={
          editTarget
            ? standingInstructionDisplayTitle({
                title: editTarget.title,
                content: editTarget.content,
              })
            : ''
        }
        initialContent={editTarget?.content ?? ''}
        onConfirm={handleEditSave}
        showApplyToAllChatrooms={editTarget !== null && !isSyntheticCurrentItem(editTarget)}
      />
      <StandingInstructionsDeleteConfirm
        open={deleteTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteTarget(null);
        }}
        onConfirm={handleDeleteConfirm}
        description={
          deleteTarget && isSyntheticCurrentItem(deleteTarget)
            ? 'Clear this standing instruction and disable it in this chatroom?'
            : undefined
        }
      />
    </>
  );

  if (!isDesktop) {
    return (
      <Drawer
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onOpenChange(false);
        }}
        repositionInputs={false}
        handleOnly
      >
        <DrawerContent
          className={MOBILE_DRAWER_CONTENT_CLASSNAME}
          style={getMobileDrawerContentStyle(keyboardInsetPx, viewportOffsetTopPx)}
        >
          <DrawerHeader className="px-4 pt-4 pb-2 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <DrawerTitle
                className={cn(chatroomIndustrialDialogTitleClassName, 'min-w-0 leading-tight')}
              >
                Standing instructions
              </DrawerTitle>
              {viewMoreButton}
            </div>
          </DrawerHeader>
          <div className="flex flex-col min-h-0 flex-1 overflow-y-auto">{content}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onOpenChange(false);
      }}
      modal={true}
    >
      <DialogContent floating className="sm:max-w-md max-h-[min(90dvh,100%)]">
        <DialogHeader className="flex-row items-center justify-between gap-2 space-y-0 pr-8">
          <DialogTitle>Standing instructions</DialogTitle>
          {viewMoreButton}
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
