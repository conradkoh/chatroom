'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SketchBrushSizeControl } from './SketchBrushSizeControl';
import { SketchColorPicker } from './SketchColorPicker';
import { SKETCH_CANVAS_BACKGROUND } from './sketchConstants';
import { useSketchCanvas } from './useSketchCanvas';
import { chatroomIndustrialButtonPrimaryClassName, chatroomIndustrialButtonSecondaryClassName } from '../shared/industrialDialogStyles';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
export type SketchDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; onSave: (file: File) => void };
export function SketchDialog({ open, onOpenChange, onSave }: SketchDialogProps) {
  const { canvasRef, bindCanvas, brushColor, setBrushColor, brushSize, setBrushSize, hasContent, exportPngFile } = useSketchCanvas();
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => { if (!open || !canvasRef.current) return; return bindCanvas(canvasRef.current); }, [bindCanvas, canvasRef, open]);
  const save = async () => { if (isSaving || !hasContent) return; setIsSaving(true); try { const file = await exportPngFile(); if (!file) { toast.error('Failed to export sketch'); return; } onSave(file); onOpenChange(false); } finally { setIsSaving(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent aria-busy={isSaving} className="flex h-[min(90dvh,760px)] w-[calc(100vw-1rem)] max-w-[1100px] flex-col gap-4 p-4 sm:h-[min(85dvh,760px)] sm:w-[min(92vw,1100px)] sm:p-6"><DialogHeader><DialogTitle>Sketch attachment</DialogTitle></DialogHeader><div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"><SketchColorPicker value={brushColor} onChange={setBrushColor} disabled={isSaving} /><SketchBrushSizeControl value={brushSize} onChange={setBrushSize} disabled={isSaving} /></div><div className="min-h-0 flex-1 overflow-hidden border-2 border-chatroom-border"><canvas ref={canvasRef} className="block h-full min-h-[240px] w-full touch-none cursor-crosshair sm:min-h-[320px]" style={{ backgroundColor: SKETCH_CANVAS_BACKGROUND }} aria-label="Sketch canvas" /></div><DialogFooter><button type="button" className={chatroomIndustrialButtonSecondaryClassName} disabled={isSaving} onClick={() => onOpenChange(false)}>Cancel</button><button type="button" className={chatroomIndustrialButtonPrimaryClassName} disabled={!hasContent || isSaving} onClick={save}>{isSaving ? 'Adding…' : 'Add sketch'}</button></DialogFooter></DialogContent></Dialog>;
}
