'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { SketchBrushSizeControl } from './SketchBrushSizeControl';
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

export function SketchDialog({ open, onOpenChange, onSave }: SketchDialogProps) {
  const { canvasRef, bindCanvas, brushSize, setBrushSize, hasContent, clear, exportPngFile } =
    useSketchCanvas();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    return bindCanvas(canvasRef.current);
  }, [bindCanvas, canvasRef, open]);

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
      <DialogContent className="flex h-[min(85vh,760px)] w-[min(92vw,1100px)] max-w-none flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Sketch attachment</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-chatroom-text-muted">
            <Pencil size={16} aria-hidden />
            <span className="text-xs">Draw with your pointer</span>
          </div>
          <div className="flex items-center gap-3">
            <SketchBrushSizeControl value={brushSize} onChange={setBrushSize} />
            <button
              type="button"
              aria-label="Clear canvas"
              title="Clear canvas"
              onClick={clear}
              className="text-chatroom-text-muted hover:text-chatroom-text-primary"
            >
              <Trash2 size={16} aria-hidden />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden border-2 border-chatroom-border bg-chatroom-bg-primary">
          <canvas
            ref={canvasRef}
            className="block h-full min-h-[320px] w-full touch-none"
            aria-label="Sketch canvas"
          />
        </div>
        <DialogFooter>
          <button
            type="button"
            className={chatroomIndustrialButtonSecondaryClassName}
            onClick={() => onOpenChange(false)}
          >
            Dismiss
          </button>
          <button
            type="button"
            className={chatroomIndustrialButtonPrimaryClassName}
            disabled={!hasContent || isSaving}
            onClick={save}
          >
            Confirm
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
