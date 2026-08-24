'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from 'react';
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
import { SketchDiscardDialog } from './SketchDiscardDialog';
import { SketchToolRail } from './SketchToolRail';
import { SKETCH_ENABLED_TOOL_IDS, type SketchToolId } from './sketchTools';
import { useSketchBrushCursor } from './useSketchBrushCursor';
import { useSketchClipboardPaste } from './useSketchClipboardPaste';
import { useSketchDocument, type UseSketchDocumentResult } from './useSketchDocument';
import { useSketchManipulation } from './useSketchManipulation';
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
type SketchEditorSessionProps = {
  onDismiss: () => void;
  onSave: (file: File) => void;
  registerRequestDismiss: (requestDismiss: () => void) => void;
};
function composePointerHandlers(
  ...handlers: (ComponentProps<'canvas'>['onPointerMove'] | undefined)[]
): ComponentProps<'canvas'>['onPointerMove'] {
  return (event) => handlers.forEach((handler) => handler?.(event));
}
type SketchEditorPropertiesProps = {
  brushColor: SketchBrushColor;
  brushSize: number;
  disabled: boolean;
  onBrushColorChange: (color: SketchBrushColor) => void;
  onBrushSizeChange: (size: number) => void;
  activeTool: SketchToolId;
  selection: SketchSelectionRect | null;
  onRequestDelete: (selection: SketchSelectionRect) => void;
  floating?: UseSketchDocumentResult['floating'];
  onApplyFloating?: () => void;
  onCancelFloating?: () => void;
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
  floating,
  onApplyFloating,
  onCancelFloating,
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
      ) : activeTool === 'move' || activeTool === 'transform' ? (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
            {activeTool}
          </p>
          <p className="text-sm text-chatroom-text-secondary">
            {floating
              ? 'Adjust the floating selection, then apply or cancel.'
              : 'Select an area first.'}
          </p>
          {floating ? (
            <p aria-live="polite" className="text-sm text-chatroom-text-muted">
              {Math.round(floating.sourceWidth * floating.transform.scaleX)} ×{' '}
              {Math.round(floating.sourceHeight * floating.transform.scaleY)} px
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!floating || disabled}
              onClick={onApplyFloating}
              className={chatroomIndustrialButtonPrimaryClassName}
            >
              Apply
            </button>
            <button
              type="button"
              disabled={!floating || disabled}
              onClick={onCancelFloating}
              className={chatroomIndustrialButtonSecondaryClassName}
            >
              Cancel
            </button>
          </div>
        </>
      ) : activeTool === 'eraser' ? (
        <>
          <p className="hidden text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted lg:block">
            Eraser
          </p>
          <p className="text-sm text-chatroom-text-secondary">Drag on canvas to erase pixels.</p>
          <SketchBrushSizeControl
            value={brushSize}
            onChange={onBrushSizeChange}
            disabled={disabled}
          />
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

// fallow-ignore-next-line complexity
function SketchEditorCanvasPanel({
  canvasRef,
  canvasBindings,
  disabled,
  overlayRef,
  selectionBindings,
  activeTool,
  showBrushCursor,
  manipulationBindings,
}: Pick<UseSketchDocumentResult, 'canvasRef' | 'canvasBindings'> & {
  disabled?: boolean;
  overlayRef?: RefObject<HTMLCanvasElement | null>;
  selectionBindings?: UseSketchDocumentResult['canvasBindings'];
  activeTool?: SketchToolId;
  showBrushCursor?: boolean;
  manipulationBindings?: UseSketchDocumentResult['canvasBindings'];
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
          disabled
            ? 'cursor-not-allowed opacity-60'
            : showBrushCursor
              ? 'cursor-none'
              : 'cursor-crosshair',
          'ring-2 ring-chatroom-border'
        )}
        style={{ backgroundColor: SKETCH_CANVAS_BACKGROUND }}
        {...(activeTool === 'select'
          ? selectionBindings
          : activeTool === 'move' || activeTool === 'transform'
            ? manipulationBindings
            : canvasBindings)}
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

// fallow-ignore-next-line complexity
function SketchEditorSession({
  onDismiss,
  onSave,
  registerRequestDismiss,
}: SketchEditorSessionProps) {
  const [brushColor, setBrushColor] = useState(SKETCH_BRUSH_COLOR_DEFAULT);
  const [brushSize, setBrushSize] = useState(SKETCH_BRUSH_SIZE_DEFAULT);
  const [isSaving, setIsSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<SketchToolId>('brush');
  useSketchToolShortcuts({ enabledTools: SKETCH_ENABLED_TOOL_IDS, onToolChange: setActiveTool });
  const isDrawingTool = activeTool === 'brush' || activeTool === 'eraser';
  const brushInputDisabled = isSaving || !isDrawingTool;
  const effectiveBrushColor =
    activeTool === 'eraser' ? (SKETCH_CANVAS_BACKGROUND as SketchBrushColor) : brushColor;
  const {
    canvasRef,
    canvasBindings,
    hasContent,
    exportPngFile,
    deleteRegion,
    selection: docSelection,
    clearSelection,
    onSelectionChange,
    activeLayerId,
    importPastedImage,
    floating,
    beginFloatingSelection,
    updateFloatingTransform,
    applyFloatingSelection,
    cancelFloatingSelection,
  } = useSketchDocument({
    brushColor: effectiveBrushColor,
    brushSize,
    disabled: brushInputDisabled,
    eraserMode: activeTool === 'eraser',
  });
  const { onPaste, isImporting } = useSketchClipboardPaste({
    disabled: isSaving,
    importPastedImage,
    onTransformRequested: () => setActiveTool('transform'),
  });
  const clearSelectionRef = useRef<() => void>(() => {});
  const handleDeleteSelection = useCallback(
    (selection: SketchSelectionRect) => {
      deleteRegion(selection);
      clearSelection();
    },
    [deleteRegion]
  );
  const { overlayRef, selection, selectionBindings } = useSketchSelection({
    canvasRef,
    activeLayerId,
    selection: docSelection,
    onSelectionChange,
    enabled: activeTool === 'select',
    disabled: isSaving,
    onRequestDelete: handleDeleteSelection,
  });
  const { brushCursorBindings, showBrushCursor } = useSketchBrushCursor({
    canvasRef,
    overlayRef,
    enabled: isDrawingTool && !isSaving,
    brushSize,
    variant: activeTool === 'eraser' ? 'eraser' : 'brush',
  });
  const drawingBindings = isDrawingTool
    ? {
        ...canvasBindings,
        onPointerMove: composePointerHandlers(
          canvasBindings.onPointerMove,
          brushCursorBindings.onPointerMove
        ),
        onPointerLeave: brushCursorBindings.onPointerLeave,
      }
    : canvasBindings;
  const { manipulationBindings } = useSketchManipulation({
    canvasRef,
    overlayRef,
    activeTool: activeTool === 'transform' ? 'transform' : 'move',
    disabled: isSaving,
    selection: docSelection,
    floating,
    beginFloatingSelection,
    updateFloatingTransform,
  });
  clearSelectionRef.current = clearSelection;
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
  const requestDismiss = useCallback(() => {
    if (isSaving) return;
    if (floating) {
      cancelFloatingSelection();
      return;
    }
    if (!hasContent) {
      onDismiss();
      return;
    }
    setDiscardOpen(true);
  }, [cancelFloatingSelection, floating, hasContent, isSaving, onDismiss]);
  useEffect(() => registerRequestDismiss(requestDismiss), [registerRequestDismiss, requestDismiss]);
  const confirmDiscard = useCallback(() => {
    setDiscardOpen(false);
    onDismiss();
  }, [onDismiss]);
  return (
    <div
      aria-busy={isSaving || isImporting}
      onPaste={onPaste}
      className="flex min-h-0 flex-1 flex-col"
    >
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
          canvasBindings={drawingBindings}
          disabled={isSaving}
          overlayRef={overlayRef}
          selectionBindings={selectionBindings}
          activeTool={activeTool}
          showBrushCursor={showBrushCursor}
          manipulationBindings={manipulationBindings}
        />
        <SketchEditorProperties
          brushColor={brushColor}
          brushSize={brushSize}
          disabled={isSaving}
          activeTool={activeTool}
          selection={selection}
          onRequestDelete={handleDeleteSelection}
          onBrushColorChange={setBrushColor}
          onBrushSizeChange={setBrushSize}
          floating={floating}
          onApplyFloating={applyFloatingSelection}
          onCancelFloating={cancelFloatingSelection}
        />
      </div>
      <SketchEditorFooter
        className="shrink-0 px-4 py-3 lg:px-5"
        isSaving={isSaving}
        hasContent={hasContent}
        onDismiss={requestDismiss}
        onSave={save}
      />
      <SketchDiscardDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={confirmDiscard}
      />
    </div>
  );
}

export function SketchDialog({ open, onOpenChange, onSave }: SketchDialogProps) {
  const requestDismissRef = useRef<() => void>(() => onOpenChange(false));
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) onOpenChange(true);
      else requestDismissRef.current();
    },
    [onOpenChange]
  );
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        floating
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          requestDismissRef.current();
        }}
        className="flex h-[min(90dvh,760px)] w-[calc(100vw-1rem)] max-w-[1100px] flex-col gap-0 p-0 sm:h-[min(85dvh,760px)] sm:w-[min(92vw,1100px)] lg:h-[calc(100dvh-2rem)] lg:w-[calc(100vw-2rem)] lg:max-w-none"
      >
        <SketchEditorSession
          onDismiss={() => onOpenChange(false)}
          onSave={onSave}
          registerRequestDismiss={(requestDismiss) => {
            requestDismissRef.current = requestDismiss;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
