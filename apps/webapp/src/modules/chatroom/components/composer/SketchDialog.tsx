'use client';
import { BoxSelect, Eraser, Pencil, Trash2, Undo2, Redo2, Pipette } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useSketchCanvas } from './useSketchCanvas';
import { SketchColorPicker } from './SketchColorPicker';
import { SketchBrushSizeControl } from './SketchBrushSizeControl';
import { SketchZoomControls } from './SketchZoomControls';
import { SketchSelectionOverlay } from './SketchSelectionOverlay';
import { useSketchViewportPan } from './useSketchViewportPan';
import { SKETCH_CANVAS_MIN_HEIGHT_CSS_PX } from './sketchConstants';
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { canvasRef, bindCanvas, hasContent, clear, exportPngFile, tool, setTool, brushColor, setBrushColor, brushSize, setBrushSize, zoom, setZoom, selectionMarquee, floatingSelection, onResizeHandlePointerDown, deleteSelection, copySelection, pasteFromClipboard, pickColorAt, commitSelection, canUndo, canRedo, undo, redo } =
    useSketchCanvas({ getScrollContainer: () => scrollContainerRef.current });
  const [isSaving, setIsSaving] = useState(false);
  const isDesktop = useIsDesktop();
  useSketchViewportPan({ open, zoom, scrollRef: scrollContainerRef });
  useEffect(() => { if (!open) return; const onKey = (e: KeyboardEvent) => { const t=e.target; if(t instanceof HTMLInputElement||t instanceof HTMLTextAreaElement||t instanceof HTMLSelectElement||(t instanceof HTMLElement&&t.isContentEditable))return; const key=e.key.toLowerCase(); if((e.metaKey||e.ctrlKey)&&key==='z'&&!e.shiftKey){e.preventDefault();undo();return;} if((e.metaKey||e.ctrlKey)&&((key==='z'&&e.shiftKey)||key==='y')){e.preventDefault();redo();return;} if((e.metaKey||e.ctrlKey)&&key==='v'){e.preventDefault();void pasteFromClipboard().catch(()=>toast.error('Nothing to paste'));return;} if(key==='i'){e.preventDefault();setTool('eyedropper');return;} if(key==='['){e.preventDefault();setBrushSize(brushSize-1);return;} if(key===']'){e.preventDefault();setBrushSize(brushSize+1);return;} if(!floatingSelection)return; if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelection();} if((e.metaKey||e.ctrlKey)&&key==='c'){e.preventDefault();void copySelection().catch(()=>toast.error('Failed to copy selection'));} }; window.addEventListener('keydown',onKey); return()=>window.removeEventListener('keydown',onKey); }, [open,floatingSelection,undo,redo,deleteSelection,copySelection,pasteFromClipboard,brushSize,setBrushSize,setTool]);
  const handleOpenChange = (next: boolean) => { if (!next) commitSelection(); onOpenChange(next); };
  useEffect(() => {
    if (!open || !canvasRef.current) return;
    return bindCanvas(canvasRef.current);
  }, [bindCanvas, open, canvasRef]);
  useEffect(() => {
    if (!open || isDesktop) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => { if (timer) { window.clearTimeout(timer); timer = null; } };
    let downX = 0; let downY = 0;
    const onDown = (e: PointerEvent) => { clear(); const r = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; downX = ((e.clientX - r.left) * (canvas.width / r.width)) / dpr; downY = ((e.clientY - r.top) * (canvas.height / r.height)) / dpr; timer = setTimeout(() => { if (tool === 'pen') { const hex = pickColorAt(downX, downY); if (hex) toast.success('Picked color'); else toast.error('Nothing to pick'); } else void pasteFromClipboard().catch(() => toast.error('Nothing to paste')); }, 500); };
    const onUp = () => clear();
    canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp); canvas.addEventListener('pointermove', onUp);
    return () => { clear(); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('pointermove', onUp); };
  }, [canvasRef, isDesktop, open, pasteFromClipboard, pickColorAt, tool]);
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
          <button type="button" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={undo}><Undo2 /></button>
          <button type="button" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={redo}><Redo2 /></button>
          <button
            type="button"
            aria-label="Eraser"
            title="Eraser"
            aria-pressed={tool === 'eraser'}
            onClick={() => setTool('eraser')}
          >
            <Eraser />
          </button>
          <button type="button" aria-label="Eyedropper" title="Eyedropper (I)" aria-pressed={tool === 'eyedropper'} onClick={() => setTool('eyedropper')}><Pipette /></button>
          <button
            type="button"
            aria-label="Clear canvas"
            title="Clear canvas"
            onClick={clear}
          >
            <Trash2 />
          </button>
          {isDesktop && <button type="button" aria-label="Select" title="Select" aria-pressed={tool === 'select'} onClick={() => setTool('select')}><BoxSelect /></button>}
          {tool !== 'select' && tool !== 'eraser' && tool !== 'eyedropper' && <SketchColorPicker value={brushColor} onChange={setBrushColor} />}
          {tool === 'pen' && <SketchBrushSizeControl value={brushSize} onChange={setBrushSize} />}
          <SketchZoomControls zoom={zoom} onZoomChange={setZoom} />
        </div>
        <DialogScrollBody ref={scrollContainerRef} className="relative w-full overflow-auto border-2 border-chatroom-border bg-white">
          <div className="relative" style={{ width: zoom > 1 ? `${zoom * 100}%` : '100%', minHeight: SKETCH_CANVAS_MIN_HEIGHT_CSS_PX * zoom }}>
            <canvas
              ref={canvasRef}
              className="block h-full min-h-[280px] w-full touch-none"
              aria-label="Sketch canvas"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
            />
            {isDesktop && tool === 'select' && <SketchSelectionOverlay zoom={zoom} marquee={selectionMarquee} selection={floatingSelection} onHandlePointerDown={(h,e) => onResizeHandlePointerDown(h,e)} />}
          </div>
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
