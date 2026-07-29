'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import {
  getMobileDrawerContentStyle,
  MOBILE_DRAWER_CONTENT_CLASSNAME,
} from '../../../components/picker';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportKeyboardInset } from '@/hooks/useMobileKeyboard';
import { StandingInstructionsDialogContent } from './StandingInstructionsDialogContent';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';
import type {
  StandingInstructionsAddSelection,
  StandingInstructionsDialogInitialView,
  StandingInstructionsDialogView,
} from '../types/standingInstructionsDialog';

export interface StandingInstructionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialView: StandingInstructionsDialogInitialView;
  storedContent: string;
  storedName: string;
  isActive: boolean;
  history: StandingInstructionHistoryItem[];
  onConfirm: (payload: { content: string; name: string }) => void;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
  onRecordHistoryUse: (historyId: string) => Promise<{ content: string }>;
}

const TITLES: Record<StandingInstructionsDialogView, string> = {
  actions: 'Standing instructions',
  add: 'Standing Instructions',
  edit: 'Edit standing instructions',
  history: 'Standing instruction history',
};

export function StandingInstructionsDialog({
  open,
  onOpenChange,
  initialView,
  storedContent,
  storedName,
  isActive,
  history,
  onConfirm: onConfirmProp,
  onEnable,
  onDisable,
  onDelete,
  onRecordHistoryUse,
}: StandingInstructionsDialogProps) {
  const isDesktop = useIsDesktop();
  const keyboardInsetPx = useVisualViewportKeyboardInset(open && !isDesktop);

  const [view, setView] = useState<StandingInstructionsDialogView>(initialView);
  const [addSelection, setAddSelection] = useState<StandingInstructionsAddSelection>(null);
  const [draft, setDraft] = useState(storedContent);
  const [draftName, setDraftName] = useState(storedName);

  useEffect(() => {
    if (!open) return;
    setView(initialView);
    setAddSelection(null);
    setDraft(storedContent);
    setDraftName(storedName);
  }, [open, initialView, storedContent, storedName]);

  const handleSelectHistory = useCallback(
    async (item: StandingInstructionHistoryItem) => {
      const result = await onRecordHistoryUse(item.id);
      setDraft(result.content);
      setAddSelection(item.id);
      if (view === 'history') setView('add');
    },
    [onRecordHistoryUse, view]
  );

  const handleSelectCreateNew = useCallback(() => {
    setAddSelection('create-new');
    setDraft('');
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirmProp({ content: draft, name: draftName });
    onOpenChange(false);
  }, [draft, draftName, onConfirmProp, onOpenChange]);

  const handleCancel = useCallback(() => {
    setDraft(storedContent);
    setDraftName(storedName);
    setAddSelection(null);
    onOpenChange(false);
  }, [storedContent, storedName, onOpenChange]);

  const confirmDisabled =
    addSelection === null || (addSelection === 'create-new' && draft.trim().length === 0);

  const historyTop3 = history.slice(0, 3);
  const title = TITLES[view];

  const content = (
    <StandingInstructionsDialogContent
      view={view}
      mobile={!isDesktop}
      isActive={isActive}
      history={history}
      historyTop3={historyTop3}
      addSelection={addSelection}
      draft={draft}
      draftName={draftName}
      confirmDisabled={view === 'add' ? confirmDisabled : false}
      onDraftChange={setDraft}
      onDraftNameChange={setDraftName}
      onSelectHistory={handleSelectHistory}
      onSelectCreateNew={handleSelectCreateNew}
      onViewMore={() => setView('history')}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      onEdit={() => setView('edit')}
      onEnable={onEnable}
      onDisable={onDisable}
      onDelete={onDelete}
    />
  );

  if (!isDesktop) {
    return (
      <Drawer
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) handleCancel();
        }}
        repositionInputs={false}
        handleOnly
      >
        <DrawerContent
          className={MOBILE_DRAWER_CONTENT_CLASSNAME}
          style={getMobileDrawerContentStyle(keyboardInsetPx)}
        >
          <DrawerHeader className="p-0 shrink-0">
            <DrawerTitle className="sr-only">{title}</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col min-h-0 flex-1 overflow-y-auto px-4 pb-4">{content}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleCancel();
      }}
    >
      <DialogContent floating className="sm:max-w-md max-h-[min(90dvh,100%)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {view !== 'actions' ? (
            <DialogDescription>
              {view === 'add' ? 'Choose from history or create new standing instructions.' : null}
              {view === 'edit' ? 'Edit the standing instructions content.' : null}
              {view === 'history' ? 'Browse all standing instruction history.' : null}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
