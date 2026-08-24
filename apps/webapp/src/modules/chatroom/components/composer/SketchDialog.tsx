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
};

function SketchEditorProperties({
  brushColor,
  brushSize,
  disabled,
  onBrushColorChange,
  onBrushSizeChange,
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
      <p className="hidden text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted lg:block">
        Brush
      </p>
      <SketchColorPicker value={brushColor} onChange={onBrushColorChange} disabled={disabled} />
      <SketchBrushSizeControl value={brushSize} onChange={onBrushSizeChange} disabled={disabled} />
    </div>
  );
}

function SketchEditorCanvasPanel({
  canvasRef,
  canvasBindings,
  disabled,
}: Pick<UseSketchCanvasResult, 'canvasRef' | 'canvasBindings'> & { disabled?: boolean }) {
  return (
    <div className="order-2 grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden bg-chatroom-bg-tertiary p-3 sm:p-4 lg:order-none lg:p-8">
      <canvas
        ref={canvasRef}
        width={SKETCH_CANVAS_WIDTH}
        height={SKETCH_CANVAS_HEIGHT}
        aria-label="Sketch canvas"
        className={cn(
          'block h-auto max-h-full w-auto max-w-full touch-none select-none',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-crosshair',
          'ring-2 ring-chatroom-border'
        )}
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
    <div aria-busy={isSaving} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="min-h-12 shrink-0 justify-center border-b-2 border-chatroom-border px-4 pr-12 text-left">
        <DialogTitle>Sketch attachment</DialogTitle>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_15rem]">
        <SketchEditorCanvasPanel
          canvasRef={canvasRef}
          canvasBindings={canvasBindings}
          disabled={isSaving}
        />
        <SketchEditorProperties
          brushColor={brushColor}
          brushSize={brushSize}
          disabled={isSaving}
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
