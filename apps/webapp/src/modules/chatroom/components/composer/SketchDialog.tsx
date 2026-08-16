'use client';
import { Eraser, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useSketchCanvas } from './useSketchCanvas';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
          <Button
            type="button"
            size="icon"
            variant={tool === 'pen' ? 'secondary' : 'ghost'}
            aria-label="Pen"
            title="Pen"
            aria-pressed={tool === 'pen'}
            onClick={() => setTool('pen')}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            size="icon"
            variant={tool === 'eraser' ? 'secondary' : 'ghost'}
            aria-label="Eraser"
            title="Eraser"
            aria-pressed={tool === 'eraser'}
            onClick={() => setTool('eraser')}
          >
            <Eraser />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Clear canvas"
            title="Clear canvas"
            onClick={clear}
          >
            <Trash2 />
          </Button>
        </div>
        <div className="min-h-[280px] w-full border-2 border-chatroom-border bg-white">
          <canvas
            ref={canvasRef}
            className="block w-full h-full min-h-[280px] touch-none"
            aria-label="Sketch canvas"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!hasContent || isSaving} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
