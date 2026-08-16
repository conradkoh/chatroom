'use client';
import { Eraser, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useSketchCanvas } from './useSketchCanvas';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogScrollBody,
} from '../ui/dialog';
import {
  chatroomIndustrialButtonPrimaryClassName,
  chatroomIndustrialButtonSecondaryClassName,
} from '../shared/industrialDialogStyles';

export type SketchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (file: File) => void;
};
export function SketchDialog({ open, onOpenChange, onSave }: SketchDialogProps) {
  const { canvasRef, bindCanvas, hasContent, clear, exportPngFile, tool, setTool } =
    useSketchCanvas();
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => {
    if (!open || !canvasRef.current) return;
    return bindCanvas(canvasRef.current);
  }, [bindCanvas, open, canvasRef]);
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
      <DialogContent className="flex flex-col min-h-0 max-h-[85vh] w-full max-w-lg">
        <DialogHeader>
          <DialogTitle>Sketch attachment</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Pen"
            title="Pen"
            aria-pressed={tool === 'pen'}
            onClick={() => setTool('pen')}
          >
            <Pencil />
          </button>
          <button
            type="button"
            aria-label="Eraser"
            title="Eraser"
            aria-pressed={tool === 'eraser'}
            onClick={() => setTool('eraser')}
          >
            <Eraser />
          </button>
          <button
            type="button"
            aria-label="Clear canvas"
            title="Clear canvas"
            onClick={clear}
          >
            <Trash2 />
          </button>
        </div>
        <DialogScrollBody className="min-h-[280px] w-full border-2 border-chatroom-border bg-white">
          <canvas
            ref={canvasRef}
            className="block w-full h-full min-h-[280px] touch-none"
            aria-label="Sketch canvas"
          />
        </DialogScrollBody>
        <DialogFooter>
          <button
            type="button"
            className={chatroomIndustrialButtonSecondaryClassName}
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
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
