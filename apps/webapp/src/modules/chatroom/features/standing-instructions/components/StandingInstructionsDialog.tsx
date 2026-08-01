'use client';

import { useCallback, useState } from 'react';

import { StandingInstructionsDialogContent } from './StandingInstructionsDialogContent';
import {
  getMobileDrawerContentStyle,
  MOBILE_DRAWER_CONTENT_CLASSNAME,
} from '../../../components/picker';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';
import type {
  StandingInstructionsAddSelection,
  StandingInstructionsDialogInitialView,
  StandingInstructionsDialogView,
} from '../types/standingInstructionsDialog';

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportKeyboardInset } from '@/hooks/useMobileKeyboard';

export interface StandingInstructionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialView: StandingInstructionsDialogInitialView;
  storedContent: string;
  storedTitle: string;
  isActive: boolean;
  history: StandingInstructionHistoryItem[];
  onConfirm: (payload: { content: string; title: string }) => void;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
  onRecordHistoryUse: (historyId: string) => Promise<{ content: string; title: string }>;
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
  storedTitle,
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
  const [draftTitle, setDraftTitle] = useState(storedTitle);

  const handleSelectHistory = useCallback(
    async (item: StandingInstructionHistoryItem) => {
      const result = await onRecordHistoryUse(item.id);
      setDraft(result.content);
      setDraftTitle(result.title);
      setAddSelection(item.id);
      if (view === 'history') setView('add');
    },
    [onRecordHistoryUse, view]
  );

  const handleEnable = useCallback(() => {
    onEnable();
    onOpenChange(false);
  }, [onEnable, onOpenChange]);

  const handleDisableCb = useCallback(() => {
    onDisable();
    onOpenChange(false);
  }, [onDisable, onOpenChange]);

  const handleDeleteCb = useCallback(() => {
    onDelete();
    onOpenChange(false);
  }, [onDelete, onOpenChange]);

  const handleSelectCreateNew = useCallback(() => {
    setAddSelection('create-new');
    setDraft('');
    setDraftTitle('');
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirmProp({ content: draft, title: draftTitle });
    onOpenChange(false);
  }, [draft, draftTitle, onConfirmProp, onOpenChange]);

  const handleCancel = useCallback(() => {
    setDraft(storedContent);
    setDraftTitle(storedTitle);
    setAddSelection(null);
    onOpenChange(false);
  }, [storedContent, storedTitle, onOpenChange]);

  const hasContent = draft.trim().length > 0;
  const hasTitle = draftTitle.trim().length > 0;
  const confirmDisabled = addSelection === null || !hasContent || !hasTitle;

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
      draftTitle={draftTitle}
      confirmDisabled={confirmDisabled}
      onDraftChange={setDraft}
      onDraftTitleChange={setDraftTitle}
      onSelectHistory={handleSelectHistory}
      onSelectCreateNew={handleSelectCreateNew}
      onViewMore={() => setView('history')}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
      onEdit={() => setView('edit')}
      onEnable={handleEnable}
      onDisable={handleDisableCb}
      onDelete={handleDeleteCb}
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
      modal={false}
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
