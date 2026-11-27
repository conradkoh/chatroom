'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

import { useTransferImport, type ImportViewState } from '../hooks/useTransferImport';
import {
  IMPORT_DIALOG_DESCRIPTION,
  IMPORT_DIALOG_TITLE,
  IMPORT_KEEP_OPEN_COPY,
  importResultTitle,
  importingTitle,
} from '../lib/transferCopy';
import { ImportFileStep } from './import/ImportFileStep';
import { ImportProgressStep } from './import/ImportProgressStep';
import { ImportResultStep } from './import/ImportResultStep';
import { ImportSelectStep } from './import/ImportSelectStep';
import { ImportTargetMachine, type ImportTarget } from './import/ImportTargetMachine';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ImportDialogProps {
  /** The machine this dialog imports into. The owning machine card supplies it. */
  target: ImportTarget;
  onClose(): void;
  /** The trigger that opened the dialog; focus returns here on close. */
  finalFocusRef: RefObject<HTMLElement | null>;
}

/**
 * The import dialog. The step is derived from the hook state, never tracked
 * separately; closing during an import is a two-step, inline confirmation so no
 * room is rolled back by an accidental Escape or overlay click.
 */
// fallow-ignore-next-line complexity
export function ImportDialog({ target, onClose, finalFocusRef }: ImportDialogProps) {
  const transfer = useTransferImport(target.machineId);
  const { state } = transfer;
  const [confirmingStop, setConfirmingStop] = useState(false);
  const locked = state.kind === 'importing';
  const titleRef = useRef<HTMLHeadingElement>(null);
  const chooseFileRef = useRef<HTMLButtonElement>(null);
  const chooseAnotherRef = useRef<HTMLButtonElement>(null);
  const selectAllRef = useRef<HTMLButtonElement>(null);
  const chooseDifferentRef = useRef<HTMLButtonElement>(null);

  const importableCount = state.kind === 'listed' ? countImportable(state) : 0;
  const showTargetHelp =
    isFileStep(state) || (state.kind === 'listed' && state.listing.entries.length > 0);

  const requestClose = () => {
    // While stopping, the dialog is locked until the rollback resolves.
    if (state.kind === 'importing' && state.cancelling) return;
    if (state.kind === 'importing') {
      setConfirmingStop(true);
      return;
    }
    transfer.reset();
    onClose();
  };

  useFocusStep(state.kind, importableCount, {
    chooseFileRef,
    chooseAnotherRef,
    selectAllRef,
    chooseDifferentRef,
    titleRef,
  });
  useClearStaleConfirm(state.kind, setConfirmingStop);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <DialogContent
        data-testid="import-dialog"
        showCloseButton={!locked}
        finalFocus={finalFocusRef}
        onEscapeKeyDown={(event) => {
          if (!locked) return;
          event.preventDefault();
          requestClose();
        }}
        className="flex! flex-col min-h-0 gap-3! max-w-[calc(100%-1rem)]! sm:max-w-2xl! max-h-[calc(100dvh-1rem)] sm:max-h-[85dvh]"
      >
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1}>
            {titleFor(state)}
          </DialogTitle>
          <DialogDescription className={descriptionClassName(state)}>
            {descriptionFor(state)}
          </DialogDescription>
        </DialogHeader>
        <ImportTargetMachine target={target} showHelp={showTargetHelp} />
        {(state.kind === 'idle' || state.kind === 'reading' || state.kind === 'rejected') && (
          <ImportFileStep
            state={state}
            onFile={transfer.loadFile}
            onClose={requestClose}
            chooseRef={chooseFileRef}
            chooseAnotherRef={chooseAnotherRef}
          />
        )}
        {state.kind === 'listed' && (
          <ImportSelectStep
            state={state}
            machineName={target.displayName}
            onToggle={transfer.toggle}
            onSelectAll={transfer.selectAll}
            onClear={transfer.clear}
            onStart={transfer.start}
            onReset={transfer.reset}
            onClose={requestClose}
            selectAllRef={selectAllRef}
            chooseDifferentRef={chooseDifferentRef}
          />
        )}
        {state.kind === 'importing' && (
          <ImportProgressStep
            state={state}
            confirmingStop={confirmingStop}
            onRequestStop={() => setConfirmingStop(true)}
            onKeep={() => setConfirmingStop(false)}
            onConfirmStop={() => {
              setConfirmingStop(false);
              void transfer.cancel();
            }}
            onClose={requestClose}
          />
        )}
        {state.kind === 'done' && (
          <ImportResultStep
            state={state}
            onRetry={transfer.retryRemaining}
            onClose={requestClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function titleFor(state: ImportViewState): string {
  if (state.kind === 'importing') {
    return state.cancelling ? 'Stopping import…' : importingTitle();
  }
  if (state.kind === 'done') {
    return importResultTitle({
      failed: state.summary.failed,
      cancelled: state.summary.cancelled,
      fatal: state.summary.fatal !== null,
    });
  }
  return IMPORT_DIALOG_TITLE;
}

function isFileStep(
  state: ImportViewState
): state is Extract<ImportViewState, { kind: 'idle' | 'reading' | 'rejected' }> {
  return state.kind === 'idle' || state.kind === 'reading' || state.kind === 'rejected';
}

function descriptionFor(state: ImportViewState): string {
  if (isFileStep(state)) return IMPORT_DIALOG_DESCRIPTION;
  if (state.kind === 'importing') return IMPORT_KEEP_OPEN_COPY;
  return state.fileName;
}

/** The select and results steps name the file in a compact mono line. */
function descriptionClassName(state: ImportViewState): string | undefined {
  return isFileStep(state) || state.kind === 'importing' ? undefined : 'font-mono text-[10px]';
}

function countImportable(state: Extract<ImportViewState, { kind: 'listed' }>): number {
  return state.listing.entries.filter(
    (entry) => entry.validity.ok && !state.importedKeys.has(entry.key)
  ).length;
}

interface StepRefs {
  chooseFileRef: RefObject<HTMLButtonElement | null>;
  chooseAnotherRef: RefObject<HTMLButtonElement | null>;
  selectAllRef: RefObject<HTMLButtonElement | null>;
  chooseDifferentRef: RefObject<HTMLButtonElement | null>;
  titleRef: RefObject<HTMLHeadingElement | null>;
}

/** Each step opens with focus on the control the user is expected to reach first. */
function useFocusStep(
  kind: ImportViewState['kind'],
  importableCount: number,
  refs: StepRefs
): void {
  const { chooseFileRef, chooseAnotherRef, selectAllRef, chooseDifferentRef, titleRef } = refs;
  useEffect(() => {
    // Base UI moves focus when the popup opens; the next frame is after it.
    const frame = requestAnimationFrame(() => {
      focusTarget(kind, importableCount, {
        chooseFileRef,
        chooseAnotherRef,
        selectAllRef,
        chooseDifferentRef,
        titleRef,
      })?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    kind,
    importableCount,
    chooseFileRef,
    chooseAnotherRef,
    selectAllRef,
    chooseDifferentRef,
    titleRef,
  ]);
}

// fallow-ignore-next-line complexity
function focusTarget(
  kind: ImportViewState['kind'],
  importableCount: number,
  refs: StepRefs
): HTMLElement | null {
  if (kind === 'idle') return refs.chooseFileRef.current;
  if (kind === 'rejected') return refs.chooseAnotherRef.current;
  if (kind === 'listed') {
    return importableCount > 0 ? refs.selectAllRef.current : refs.chooseDifferentRef.current;
  }
  if (kind === 'importing' || kind === 'done') return refs.titleRef.current;
  return null;
}

/** A stop confirmation only exists while importing; leaving the step drops it. */
function useClearStaleConfirm(
  kind: ImportViewState['kind'],
  setConfirmingStop: (value: boolean) => void
): void {
  useEffect(() => {
    if (kind !== 'importing') setConfirmingStop(false);
  }, [kind, setConfirmingStop]);
}
