'use client';

import {
  chatroomIndustrialButtonDestructiveClassName,
  chatroomIndustrialButtonPrimaryClassName,
  chatroomIndustrialButtonSecondaryClassName,
} from '../../shared/industrialDialogStyles';
import { SketchBrushSizeControl } from '../SketchBrushSizeControl';
import { isFullSketchSelection, type SketchSelectionRect } from '../sketchCanvasSelection';
import { SketchColorPicker } from '../SketchColorPicker';
import type { SketchBrushColor } from '../sketchConstants';
import type { SketchToolId } from '../sketchTools';
import type { UseSketchDocumentResult } from '../useSketchDocument';

import { cn } from '@/lib/utils';

export type SketchEditorPropertiesProps = {
  brushColor: SketchBrushColor;
  brushSize: number;
  disabled: boolean;
  onBrushColorChange: (color: SketchBrushColor) => void;
  onBrushSizeChange: (size: number) => void;
  activeTool: SketchToolId;
  selection: SketchSelectionRect | null;
  onRequestDelete?: () => void;
  isImporting?: boolean;
  floating?: UseSketchDocumentResult['floating'];
  onApplyFloating?: () => void;
  onCancelFloating?: () => void;
  className?: string;
};

// fallow-ignore-next-line complexity
export function SketchEditorProperties({
  brushColor,
  brushSize,
  disabled,
  onBrushColorChange,
  onBrushSizeChange,
  activeTool,
  selection,
  onRequestDelete,
  floating,
  onApplyFloating,
  onCancelFloating,
  isImporting,
  className,
}: SketchEditorPropertiesProps) {
  return (
    <div className={cn('flex shrink-0 flex-col gap-3 p-3 lg:p-4', className)}>
      {isImporting ? (
        <p aria-live="polite" className="text-sm text-chatroom-text-muted">
          Pasting image…
        </p>
      ) : null}
      {activeTool === 'select' ? (
        <>
          <p className="hidden text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted lg:block">
            Selection
          </p>
          <p className="text-sm text-chatroom-text-secondary">
            Drag on canvas to select an area. Press Delete to remove selected pixels. Cmd/Ctrl+A
            selects all.
          </p>
          <p aria-live="polite" className="text-sm text-chatroom-text-muted">
            {selection
              ? isFullSketchSelection(selection)
                ? 'Entire canvas selected.'
                : `${Math.round(selection.width)} × ${Math.round(selection.height)} px`
              : 'Drag on canvas to select an area'}
          </p>
          <button
            type="button"
            className={chatroomIndustrialButtonDestructiveClassName}
            disabled={!selection || disabled}
            onClick={onRequestDelete}
          >
            Delete selection
          </button>
        </>
      ) : activeTool === 'move' || activeTool === 'transform' ? (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
            {activeTool}
          </p>
          <p className="text-sm text-chatroom-text-secondary">
            {floating
              ? 'Adjust the floating selection, then apply or cancel.'
              : selection
                ? 'Drag on canvas to move the selection. Press Delete to remove selected pixels.'
                : 'Select an area first.'}
          </p>
          {floating ? (
            <p aria-live="polite" className="text-sm text-chatroom-text-muted">
              {Math.round(floating.sourceWidth * floating.transform.scaleX)} ×{' '}
              {Math.round(floating.sourceHeight * floating.transform.scaleY)} px
            </p>
          ) : selection ? (
            <p aria-live="polite" className="text-sm text-chatroom-text-muted">
              {isFullSketchSelection(selection)
                ? 'Entire canvas selected.'
                : `${Math.round(selection.width)} × ${Math.round(selection.height)} px`}
            </p>
          ) : null}
          {selection || floating ? (
            <button
              type="button"
              className={chatroomIndustrialButtonDestructiveClassName}
              disabled={disabled}
              onClick={onRequestDelete}
            >
              Delete selection
            </button>
          ) : null}
          {floating ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={onApplyFloating}
                className={chatroomIndustrialButtonPrimaryClassName}
              >
                Apply
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={onCancelFloating}
                className={chatroomIndustrialButtonSecondaryClassName}
              >
                Cancel
              </button>
            </div>
          ) : null}
        </>
      ) : activeTool === 'eraser' ? (
        <>
          <p className="hidden text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted lg:block">
            Eraser
          </p>
          <p className="text-sm text-chatroom-text-secondary">Drag on canvas to erase pixels.</p>
          <SketchBrushSizeControl
            value={brushSize}
            onChange={onBrushSizeChange}
            disabled={disabled}
          />
        </>
      ) : (
        <>
          <p className="hidden text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted lg:block">
            Brush
          </p>
          <SketchColorPicker value={brushColor} onChange={onBrushColorChange} disabled={disabled} />
          <SketchBrushSizeControl
            value={brushSize}
            onChange={onBrushSizeChange}
            disabled={disabled}
          />
        </>
      )}
    </div>
  );
}
