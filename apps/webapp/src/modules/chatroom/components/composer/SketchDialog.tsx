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
} from './sketchConstants';
import { useSketchCanvas } from './useSketchCanvas';
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
// fallow-ignore-next-line complexity
export function SketchDialog({ open, onOpenChange, onSave }: SketchDialogProps) {
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
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-busy={isSaving}
        className="flex h-[min(90dvh,760px)] w-[calc(100vw-1rem)] max-w-[1100px] flex-col gap-4 p-4 sm:h-[min(85dvh,760px)] sm:w-[min(92vw,1100px)] sm:p-6"
      >
        <DialogHeader>
          <DialogTitle>Sketch attachment</DialogTitle>
        </DialogHeader>
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <SketchColorPicker value={brushColor} onChange={setBrushColor} disabled={isSaving} />
          <SketchBrushSizeControl value={brushSize} onChange={setBrushSize} disabled={isSaving} />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden border-2 border-chatroom-border">
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
        <DialogFooter>
          <button
            type="button"
            className={chatroomIndustrialButtonSecondaryClassName}
            disabled={isSaving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className={chatroomIndustrialButtonPrimaryClassName}
            disabled={!hasContent || isSaving}
            onClick={save}
          >
            {isSaving ? 'Adding…' : 'Add sketch'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
