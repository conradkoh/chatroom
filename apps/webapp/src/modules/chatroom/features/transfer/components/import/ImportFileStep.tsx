'use client';

import { Loader2, Upload } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';

import type { ImportViewState } from '../../hooks/useTransferImport';
import { EXPORT_LIMIT_LABEL, importRejectCopy } from '../../lib/transferCopy';

import { InlineFeedback } from '@/components/inline-feedback';
import { Button } from '@/components/ui/button';
import { DialogFooter, DialogScrollBody } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { chatroomIndustrialDialogFooterClassName } from '@/modules/chatroom/components/shared/industrialDialogStyles';

type FileState = Extract<ImportViewState, { kind: 'idle' | 'reading' | 'rejected' }>;

interface ImportFileStepProps {
  state: FileState;
  onFile(file: File): void;
  onClose(): void;
  /** Focused when the step opens. */
  chooseRef: RefObject<HTMLButtonElement | null>;
  /** Focused after a rejection. */
  chooseAnotherRef: RefObject<HTMLButtonElement | null>;
}

/** The file step: drag-and-drop or picker, reading progress, and refusals. */
// fallow-ignore-next-line complexity
export function ImportFileStep({
  state,
  onFile,
  onClose,
  chooseRef,
  chooseAnotherRef,
}: ImportFileStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const openPicker = () => inputRef.current?.click();

  return (
    <>
      <DialogScrollBody className="min-h-0 flex-1 space-y-3">
        {state.kind === 'idle' && (
          <DropZone
            over={over}
            setOver={setOver}
            onFile={onFile}
            chooseRef={chooseRef}
            openPicker={openPicker}
          />
        )}
        {state.kind === 'reading' && <ReadingLine state={state} />}
        {state.kind === 'rejected' && (
          <InlineFeedback
            feedback={{
              id: 1,
              tone: 'error',
              title: 'Could not read this file',
              message: importRejectCopy(state.code, state.message, state.fileSizeBytes),
            }}
          />
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          data-testid="import-file-input"
          aria-label="Choose an export file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onFile(file);
          }}
        />
      </DialogScrollBody>
      <DialogFooter className={chatroomIndustrialDialogFooterClassName}>
        {state.kind === 'rejected' && (
          <Button ref={chooseAnotherRef} onClick={openPicker}>
            Choose another file
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

function DropZone({
  over,
  setOver,
  onFile,
  chooseRef,
  openPicker,
}: {
  over: boolean;
  setOver(open: boolean): void;
  onFile(file: File): void;
  chooseRef: RefObject<HTMLButtonElement | null>;
  openPicker(): void;
}) {
  return (
    <div
      data-testid="import-dropzone"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      className={cn(
        'flex flex-col items-center gap-3 border-2 border-dashed border-chatroom-border p-6 text-center sm:p-8',
        over && 'border-chatroom-border-strong bg-chatroom-bg-hover'
      )}
    >
      <Upload size={28} className="text-chatroom-text-muted" aria-hidden />
      <p className="hidden text-sm font-bold sm:block">Drop a .json file here</p>
      <Button ref={chooseRef} onClick={openPicker}>
        Choose file…
      </Button>
      <p className="text-xs text-chatroom-text-muted">.json, up to {EXPORT_LIMIT_LABEL}</p>
    </div>
  );
}

function ReadingLine({ state }: { state: Extract<FileState, { kind: 'reading' }> }) {
  return (
    <>
      <p role="status" className="flex items-center gap-2 text-xs">
        <Loader2 className="animate-spin" size={14} aria-hidden />
        Reading {state.fileName}…
      </p>
      {state.progress !== null && (
        <p className="text-xs text-chatroom-text-muted">
          Checking {state.progress.done} of {state.progress.total} chatrooms…
        </p>
      )}
    </>
  );
}
