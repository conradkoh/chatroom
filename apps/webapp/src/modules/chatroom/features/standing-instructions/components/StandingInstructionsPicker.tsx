'use client';

import { standingInstructionDisplayTitle } from '@workspace/backend/src/domain/entities/standing-instructions';
import { useCallback, useState } from 'react';

import { StandingInstructionsHistoryModal } from './StandingInstructionsHistoryModal';
import { StandingInstructionsPickerContent } from './StandingInstructionsPickerContent';
import { StandingInstructionsPickerFooter } from './StandingInstructionsPickerFooter';
import {
  buildStandingInstructionsPickerList,
  type PickerListItem,
} from './standingInstructionsPickerUtils';
import {
  getMobileDrawerContentStyle,
  MOBILE_DRAWER_CONTENT_CLASSNAME,
} from '../../../components/picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportKeyboardInset } from '@/hooks/useMobileKeyboard';

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
}

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
}: StandingInstructionsPickerProps) {
  const isDesktop = useIsDesktop();
  const keyboardInsetPx = useVisualViewportKeyboardInset(open && !isDesktop);

  const { visible, activeId, hasMore } = buildStandingInstructionsPickerList({
    history,
    storedContent,
    storedTitle,
    isActive,
  });

  const [selectedId, setSelectedId] = useState<string | null>(activeId);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

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

  const content = (
    <>
      <StandingInstructionsPickerContent
        visible={visible}
        activeId={activeId}
        selectedId={selectedId}
        hasMore={hasMore}
        onSelect={setSelectedId}
        onViewMore={() => setHistoryModalOpen(true)}
      />
      <StandingInstructionsPickerFooter
        isActive={isActive}
        hasContent={hasContent}
        selectedId={selectedId}
        activeId={activeId}
        onDisable={handleDisable}
        onEnable={handleEnable}
        onApply={handleFooterApply}
        mobile={!isDesktop}
      />
      <StandingInstructionsHistoryModal
        open={historyModalOpen}
        onOpenChange={setHistoryModalOpen}
        history={history}
        onSelect={handleHistorySelect}
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
          style={getMobileDrawerContentStyle(keyboardInsetPx)}
        >
          <DrawerHeader className="p-0 shrink-0">
            <DrawerTitle className="sr-only">Standing instructions</DrawerTitle>
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
        <DialogHeader>
          <DialogTitle className="sr-only">Standing instructions</DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
