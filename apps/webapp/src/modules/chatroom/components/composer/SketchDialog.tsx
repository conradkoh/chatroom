'use client';

import { useState, type RefObject } from 'react';
import { toast } from 'sonner';

import { SketchBrushSizeControl } from './SketchBrushSizeControl';
import { isFullSketchSelection, type SketchSelectionRect } from './sketchCanvasSelection';
import { SketchColorPicker } from './SketchColorPicker';
import {
  SKETCH_BRUSH_COLOR_DEFAULT,
  SKETCH_BRUSH_SIZE_DEFAULT,
  SKETCH_CANVAS_BACKGROUND,
  SKETCH_CANVAS_HEIGHT,
  SKETCH_CANVAS_WIDTH,
  type SketchBrushColor,
} from './sketchConstants';
import { SketchDeleteSelectionDialog } from './SketchDeleteSelectionDialog';
import { SketchToolRail } from './SketchToolRail';
import { SKETCH_ENABLED_TOOL_IDS, type SketchToolId } from './sketchTools';
import { useSketchCanvas, type UseSketchCanvasResult } from './useSketchCanvas';
import { useSketchSelection } from './useSketchSelection';
import { useSketchToolShortcuts } from './useSketchToolShortcuts';
import {
  chatroomIndustrialButtonPrimaryClassName,
  chatroomIndustrialButtonDestructiveClassName,
  chatroomIndustrialButtonSecondaryClassName,
} from '../shared/industrialDialogStyles';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

import { cn } from '@/lib/utils';

export type SketchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (file: File) => void;
};
type SketchEditorSessionProps = { onDismiss: () => void; onSave: (file: File) => void };
type SketchEditorPropertiesProps = {
  brushColor: SketchBrushColor;
  brushSize: number;
  disabled: boolean;
  onBrushColorChange: (color: SketchBrushColor) => void;
  onBrushSizeChange: (size: number) => void;
  activeTool: SketchToolId;
  selection: SketchSelectionRect | null;
  onRequestDelete: (selection: SketchSelectionRect) => void;
};

// fallow-ignore-next-line complexity
function SketchEditorProperties({
  brushColor,
  brushSize,
  disabled,
  onBrushColorChange,
  onBrushSizeChange,
  activeTool,
  selection,
  onRequestDelete,
}: SketchEditorPropertiesProps) {
  return (
    <div
      className={cn(
        'order-1 flex shrink-0 flex-col gap-3 border-b-2 border-chatroom-border p-3',
        'sm:flex-row sm:flex-wrap sm:items-center sm:justify-between',
        'lg:order-none lg:min-h-0 lg:flex-col lg:items-stretch lg:justify-start',
        'lg:border-b-0 lg:border-l-2 lg:p-4'
      )}
    >
      {activeTool === 'select' ? (
        <>
          <p className="hidden text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted lg:block">
            Selection
          </p>
          <p className="text-sm text-chatroom-text-secondary">
            Drag on canvas to select an area. Press Delete to remove selected pixels. Cmd/Ctrl+A
            selects all.
          </p>
          <p aria-live="polite" className="text-sm text-chatroom-text-muted">
            {selection
              ? isFullSketchSelection(selection)
                ? 'Entire canvas selected.'
                : `${Math.round(selection.width)} × ${Math.round(selection.height)} px`
              : 'Drag on canvas to select an area'}
          </p>
          <button
            type="button"
            className={chatroomIndustrialButtonDestructiveClassName}
            disabled={!selection || disabled}
            onClick={() => selection && onRequestDelete(selection)}
          >
            Delete selection
          </button>
        </>
      ) : (
        <>
          <p className="hidden text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted lg:block">
            Brush
          </p>
          <SketchColorPicker value={brushColor} onChange={onBrushColorChange} disabled={disabled} />
          <SketchBrushSizeControl
            value={brushSize}
            onChange={onBrushSizeChange}
            disabled={disabled}
          />
        </>
      )}
    </div>
  );
}

function SketchEditorCanvasPanel({
  canvasRef,
  canvasBindings,
  disabled,
  overlayRef,
  selectionBindings,
  activeTool,
}: Pick<UseSketchCanvasResult, 'canvasRef' | 'canvasBindings'> & {
  disabled?: boolean;
  overlayRef?: RefObject<HTMLCanvasElement | null>;
  selectionBindings?: UseSketchCanvasResult['canvasBindings'];
  activeTool?: SketchToolId;
}) {
  return (
    <div className="order-2 grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden bg-chatroom-bg-tertiary p-3 sm:p-4 lg:order-none lg:p-8">
      <canvas
        ref={canvasRef}
        width={SKETCH_CANVAS_WIDTH}
        height={SKETCH_CANVAS_HEIGHT}
        aria-label="Sketch canvas"
        className={cn(
          'col-start-1 row-start-1 block h-auto max-h-full w-auto max-w-full touch-none select-none',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-crosshair',
          'ring-2 ring-chatroom-border'
        )}
        style={{ backgroundColor: SKETCH_CANVAS_BACKGROUND }}
        {...(activeTool === 'select' ? selectionBindings : canvasBindings)}
      />
      {overlayRef ? (
        <canvas
          ref={overlayRef}
          width={SKETCH_CANVAS_WIDTH}
          height={SKETCH_CANVAS_HEIGHT}
          aria-hidden
          data-testid="sketch-selection-overlay"
          className="pointer-events-none col-start-1 row-start-1 block h-auto max-h-full w-auto max-w-full"
        />
      ) : null}
    </div>
  );
}

type SketchEditorFooterProps = {
  isSaving: boolean;
  hasContent: boolean;
  onDismiss: () => void;
  onSave: () => void;
  className?: string;
};
function SketchEditorFooter({
  isSaving,
  hasContent,
  onDismiss,
  onSave,
  className,
}: SketchEditorFooterProps) {
  return (
    <DialogFooter className={className}>
      <button
        type="button"
        className={chatroomIndustrialButtonSecondaryClassName}
        disabled={isSaving}
        onClick={onDismiss}
      >
        Cancel
      </button>
      <button
        type="button"
        className={cn(chatroomIndustrialButtonPrimaryClassName, 'min-w-24')}
        disabled={!hasContent || isSaving}
        onClick={onSave}
      >
        {isSaving ? 'Adding…' : 'Add sketch'}
      </button>
    </DialogFooter>
  );
}

function SketchEditorSession({ onDismiss, onSave }: SketchEditorSessionProps) {
  const [brushColor, setBrushColor] = useState(SKETCH_BRUSH_COLOR_DEFAULT);
  const [brushSize, setBrushSize] = useState(SKETCH_BRUSH_SIZE_DEFAULT);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTool, setActiveTool] = useState<SketchToolId>('brush');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SketchSelectionRect | null>(null);
  useSketchToolShortcuts({ enabledTools: SKETCH_ENABLED_TOOL_IDS, onToolChange: setActiveTool });
  const brushInputDisabled = isSaving || activeTool !== 'brush';
  const { canvasRef, canvasBindings, hasContent, exportPngFile, deleteRegion } = useSketchCanvas({
    brushColor,
    brushSize,
    disabled: brushInputDisabled,
  });
  const requestDelete = (selection: SketchSelectionRect) => {
    setPendingDelete(selection);
    setDeleteOpen(true);
  };
  const { overlayRef, selection, selectionBindings, clearSelection } = useSketchSelection({
    canvasRef,
    enabled: activeTool === 'select',
    disabled: isSaving || deleteOpen,
    onRequestDelete: requestDelete,
  });
  const save = async () => {
    if (isSaving || !hasContent) return;
    setIsSaving(true);
    try {
      const file = await exportPngFile();
      if (!file) {
        toast.error('Failed to export sketch');
        return;
      }
      onSave(file);
      onDismiss();
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <div aria-busy={isSaving} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="min-h-12 shrink-0 justify-center border-b-2 border-chatroom-border px-4 pr-12 text-left">
        <DialogTitle>Sketch attachment</DialogTitle>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[3.5rem_minmax(0,1fr)_15rem]">
        <SketchToolRail
          activeTool={activeTool}
          enabledTools={SKETCH_ENABLED_TOOL_IDS}
          disabled={isSaving}
          onToolChange={setActiveTool}
        />
        <SketchEditorCanvasPanel
          canvasRef={canvasRef}
          canvasBindings={canvasBindings}
          disabled={isSaving}
          overlayRef={overlayRef}
          selectionBindings={selectionBindings}
          activeTool={activeTool}
        />
        <SketchEditorProperties
          brushColor={brushColor}
          brushSize={brushSize}
          disabled={isSaving}
          activeTool={activeTool}
          selection={selection}
          onRequestDelete={requestDelete}
          onBrushColorChange={setBrushColor}
          onBrushSizeChange={setBrushSize}
        />
      </div>
      <SketchEditorFooter
        className="shrink-0 px-4 py-3 lg:px-5"
        isSaving={isSaving}
        hasContent={hasContent}
        onDismiss={onDismiss}
        onSave={save}
      />
      <SketchDeleteSelectionDialog
        open={deleteOpen}
        selection={pendingDelete}
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          if (pendingDelete) deleteRegion(pendingDelete);
          clearSelection();
          setPendingDelete(null);
          setDeleteOpen(false);
        }}
      />
    </div>
  );
}

export function SketchDialog({ open, onOpenChange, onSave }: SketchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        floating
        className="flex h-[min(90dvh,760px)] w-[calc(100vw-1rem)] max-w-[1100px] flex-col gap-0 p-0 sm:h-[min(85dvh,760px)] sm:w-[min(92vw,1100px)] lg:h-[calc(100dvh-2rem)] lg:w-[calc(100vw-2rem)] lg:max-w-none"
      >
        <SketchEditorSession onDismiss={() => onOpenChange(false)} onSave={onSave} />
      </DialogContent>
    </Dialog>
  );
}
