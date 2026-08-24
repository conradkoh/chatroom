'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { SketchBrushSizeControl } from './SketchBrushSizeControl';
import { SketchColorPicker } from './SketchColorPicker';
import {
  SKETCH_BRUSH_COLOR_DEFAULT,
  SKETCH_BRUSH_SIZE_DEFAULT,
  SKETCH_CANVAS_BACKGROUND,
  SKETCH_CANVAS_HEIGHT,
  SKETCH_CANVAS_WIDTH,
  type SketchBrushColor,
} from './sketchConstants';
import { useSketchCanvas, type UseSketchCanvasResult } from './useSketchCanvas';
import {
  chatroomIndustrialButtonPrimaryClassName,
  chatroomIndustrialButtonSecondaryClassName,
} from '../shared/industrialDialogStyles';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

export type SketchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (file: File) => void;
};
type SketchEditorSessionProps = { onDismiss: () => void; onSave: (file: File) => void };
type SketchEditorToolbarProps = {
  brushColor: SketchBrushColor;
  brushSize: number;
  isSaving: boolean;
  onBrushColorChange: (color: SketchBrushColor) => void;
  onBrushSizeChange: (size: number) => void;
};

function SketchEditorToolbar({
  brushColor,
  brushSize,
  isSaving,
  onBrushColorChange,
  onBrushSizeChange,
}: SketchEditorToolbarProps) {
  return (
    <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <SketchColorPicker value={brushColor} onChange={onBrushColorChange} disabled={isSaving} />
      <SketchBrushSizeControl value={brushSize} onChange={onBrushSizeChange} disabled={isSaving} />
    </div>
  );
}

function SketchEditorCanvasPanel({
  canvasRef,
  canvasBindings,
}: Pick<UseSketchCanvasResult, 'canvasRef' | 'canvasBindings'>) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-hidden border-2 border-chatroom-border bg-chatroom-bg-secondary">
      <canvas
        ref={canvasRef}
        width={SKETCH_CANVAS_WIDTH}
        height={SKETCH_CANVAS_HEIGHT}
        aria-label="Sketch canvas"
        className="block h-auto max-h-full w-auto max-w-full touch-none select-none cursor-crosshair"
        style={{ backgroundColor: SKETCH_CANVAS_BACKGROUND }}
        {...canvasBindings}
      />
    </div>
  );
}

type SketchEditorFooterProps = {
  isSaving: boolean;
  hasContent: boolean;
  onDismiss: () => void;
  onSave: () => void;
};
function SketchEditorFooter({ isSaving, hasContent, onDismiss, onSave }: SketchEditorFooterProps) {
  return (
    <DialogFooter>
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
        className={chatroomIndustrialButtonPrimaryClassName}
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
  const { canvasRef, canvasBindings, hasContent, exportPngFile } = useSketchCanvas({
    brushColor,
    brushSize,
    disabled: isSaving,
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
    <div aria-busy={isSaving} className="flex min-h-0 flex-1 flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Sketch attachment</DialogTitle>
      </DialogHeader>
      <SketchEditorToolbar
        brushColor={brushColor}
        brushSize={brushSize}
        isSaving={isSaving}
        onBrushColorChange={setBrushColor}
        onBrushSizeChange={setBrushSize}
      />
      <SketchEditorCanvasPanel canvasRef={canvasRef} canvasBindings={canvasBindings} />
      <SketchEditorFooter
        isSaving={isSaving}
        hasContent={hasContent}
        onDismiss={onDismiss}
        onSave={save}
      />
    </div>
  );
}

export function SketchDialog({ open, onOpenChange, onSave }: SketchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        floating
        aria-busy={open}
        className="flex h-[min(90dvh,760px)] w-[calc(100vw-1rem)] max-w-[1100px] flex-col gap-4 p-4 sm:h-[min(85dvh,760px)] sm:w-[min(92vw,1100px)] sm:p-6"
      >
        <SketchEditorSession onDismiss={() => onOpenChange(false)} onSave={onSave} />
      </DialogContent>
    </Dialog>
  );
}
