'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { DialogHeader, DialogTitle } from '../../ui/dialog';
import type { SketchSelectionRect } from '../sketchCanvasSelection';
import {
  SKETCH_BRUSH_COLOR_DEFAULT,
  SKETCH_BRUSH_SIZE_DEFAULT,
  SKETCH_CANVAS_BACKGROUND,
  type SketchBrushColor,
} from '../sketchConstants';
import { SketchDiscardDialog } from '../SketchDiscardDialog';
import { SketchLayersPanel } from '../SketchLayersPanel';
import { SketchToolRail } from '../SketchToolRail';
import { SKETCH_ENABLED_TOOL_IDS, type SketchToolId } from '../sketchTools';
import { useSketchBrushCursor } from '../useSketchBrushCursor';
import { useSketchClipboardPaste } from '../useSketchClipboardPaste';
import { useSketchDocument } from '../useSketchDocument';
import { useSketchManipulation } from '../useSketchManipulation';
import { useSketchSelection } from '../useSketchSelection';
import { useSketchToolShortcuts } from '../useSketchToolShortcuts';
import { composePointerHandlers } from './composePointerHandlers';
import { SketchEditorCanvasPanel } from './SketchEditorCanvasPanel';
import { SketchEditorFooter } from './SketchEditorFooter';
import { SketchEditorProperties } from './SketchEditorProperties';
import { isEditableSketchTarget, isSketchDeleteShortcut } from './sketchKeyboard';

export type SketchEditorSessionProps = {
  onDismiss: () => void;
  onSave: (file: File) => void;
  registerRequestDismiss: (requestDismiss: () => void) => void;
};

// fallow-ignore-next-line complexity
export function SketchEditorSession({
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
    discardFloatingSelection,
    layers,
    setActiveLayerId,
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
  const inputDisabled = isSaving || isImporting;
  const selectionKeyboardEnabled =
    activeTool === 'select' || activeTool === 'move' || activeTool === 'transform';
  const layersTopFirst = useMemo(() => [...layers].reverse(), [layers]);
  const layersDisabled = inputDisabled || floating != null;
  const clearSelectionRef = useRef<() => void>(() => {});
  const handleDeleteSelectionRect = useCallback(
    (selectionRect: SketchSelectionRect) => {
      deleteRegion(selectionRect);
      clearSelection();
    },
    [deleteRegion, clearSelection]
  );
  const { overlayRef, selection, selectionBindings } = useSketchSelection({
    canvasRef,
    activeLayerId,
    selection: docSelection,
    onSelectionChange,
    enabled: activeTool === 'select',
    keyboardEnabled: selectionKeyboardEnabled && !floating,
    disabled: inputDisabled,
    onRequestDelete: handleDeleteSelectionRect,
  });
  // fallow-ignore-next-line complexity
  const handleRequestDelete = useCallback(() => {
    if (floating) {
      discardFloatingSelection();
      return;
    }
    const rect = selection ?? docSelection?.rect;
    if (!rect) return;
    handleDeleteSelectionRect(rect);
  }, [
    docSelection?.rect,
    discardFloatingSelection,
    floating,
    handleDeleteSelectionRect,
    selection,
  ]);
  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (inputDisabled || !floating) return;
    if (activeTool !== 'move' && activeTool !== 'transform') return;
    const listener = (e: KeyboardEvent) => {
      if (!isSketchDeleteShortcut(e) || isEditableSketchTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      discardFloatingSelection();
    };
    document.addEventListener('keydown', listener, true);
    return () => document.removeEventListener('keydown', listener, true);
  }, [activeTool, discardFloatingSelection, floating, inputDisabled]);
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
    disabled: inputDisabled,
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
      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[3.5rem_minmax(0,1fr)_17rem]">
        <SketchToolRail
          activeTool={activeTool}
          enabledTools={SKETCH_ENABLED_TOOL_IDS}
          disabled={isSaving || isImporting}
          onToolChange={setActiveTool}
        />
        <SketchEditorCanvasPanel
          canvasRef={canvasRef}
          canvasBindings={drawingBindings}
          disabled={isSaving || isImporting}
          overlayRef={overlayRef}
          selectionBindings={selectionBindings}
          activeTool={activeTool}
          showBrushCursor={showBrushCursor}
          manipulationBindings={manipulationBindings}
        />
        <aside className="order-1 flex shrink-0 flex-col border-b-2 border-chatroom-border lg:order-none lg:min-h-0 lg:border-b-0 lg:border-l-2">
          <SketchEditorProperties
            brushColor={brushColor}
            brushSize={brushSize}
            disabled={isSaving || isImporting}
            activeTool={activeTool}
            selection={selection}
            onRequestDelete={handleRequestDelete}
            onBrushColorChange={setBrushColor}
            onBrushSizeChange={setBrushSize}
            floating={floating}
            onApplyFloating={applyFloatingSelection}
            onCancelFloating={cancelFloatingSelection}
            isImporting={isImporting}
          />
          <SketchLayersPanel
            layersTopFirst={layersTopFirst}
            activeLayerId={activeLayerId}
            disabled={layersDisabled}
            onActiveLayerChange={setActiveLayerId}
            className="min-h-0 lg:flex-1"
          />
        </aside>
      </div>
      <SketchEditorFooter
        className="shrink-0 px-4 py-3 lg:px-5"
        isSaving={isSaving}
        hasContent={hasContent}
        onDismiss={requestDismiss}
        onSave={save}
        isImporting={isImporting}
      />
      <SketchDiscardDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={confirmDiscard}
      />
    </div>
  );
}
