'use client';
import { BoxSelect, Eraser, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useSketchCanvas } from './useSketchCanvas';
import { SketchColorPicker } from './SketchColorPicker';
import { SketchZoomControls } from './SketchZoomControls';
import { SketchSelectionOverlay } from './SketchSelectionOverlay';
import { useIsDesktop } from '@/hooks/useIsDesktop';
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
  const { canvasRef, bindCanvas, hasContent, clear, exportPngFile, tool, setTool, brushColor, setBrushColor, zoom, setZoom, selectionMarquee, floatingSelection, onResizeHandlePointerDown, deleteSelection, copySelection, commitSelection } =
    useSketchCanvas();
  const [isSaving, setIsSaving] = useState(false);
  const isDesktop = useIsDesktop();
  useEffect(() => { if (!open) return; const onKey = (e: KeyboardEvent) => { if (!floatingSelection) return; if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); } if ((e.metaKey || e.ctrlKey) && e.key === 'c') { e.preventDefault(); void copySelection().catch(() => toast.error('Failed to copy selection')); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [open, floatingSelection, deleteSelection, copySelection]);
  const handleOpenChange = (next: boolean) => { if (!next) commitSelection(); onOpenChange(next); };
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex flex-col min-h-0 max-h-[85vh] w-full max-w-lg">
        <DialogHeader>
          <DialogTitle>Sketch attachment</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
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
          {isDesktop && <button type="button" aria-label="Select" title="Select" aria-pressed={tool === 'select'} onClick={() => setTool('select')}><BoxSelect /></button>}
          {tool !== 'select' && <SketchColorPicker value={brushColor} onChange={setBrushColor} disabled={tool === 'eraser'} />}
          <SketchZoomControls zoom={zoom} onZoomChange={setZoom} />
        </div>
        <DialogScrollBody className="relative min-h-[280px] w-full overflow-auto border-2 border-chatroom-border bg-white">
          <canvas
            ref={canvasRef}
            className="block w-full h-full min-h-[280px] touch-none"
            aria-label="Sketch canvas"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          />
          {isDesktop && tool === 'select' && <SketchSelectionOverlay zoom={zoom} marquee={selectionMarquee} selection={floatingSelection} onHandlePointerDown={(h,e) => onResizeHandlePointerDown(h,e)} />}
        </DialogScrollBody>
        <DialogFooter>
          <button
            type="button"
            className={chatroomIndustrialButtonSecondaryClassName}
            onClick={() => handleOpenChange(false)}
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
