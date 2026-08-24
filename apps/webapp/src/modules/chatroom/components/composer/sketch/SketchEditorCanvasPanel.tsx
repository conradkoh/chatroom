'use client';

import type { RefObject } from 'react';

import {
  SKETCH_CANVAS_BACKGROUND,
  SKETCH_CANVAS_HEIGHT,
  SKETCH_CANVAS_WIDTH,
} from '../sketchConstants';
import type { SketchToolId } from '../sketchTools';
import type { UseSketchDocumentResult } from '../useSketchDocument';

import { cn } from '@/lib/utils';

export type SketchEditorCanvasPanelProps = Pick<
  UseSketchDocumentResult,
  'canvasRef' | 'canvasBindings'
> & {
  disabled?: boolean;
  overlayRef?: RefObject<HTMLCanvasElement | null>;
  selectionBindings?: UseSketchDocumentResult['canvasBindings'];
  activeTool?: SketchToolId;
  showBrushCursor?: boolean;
  manipulationBindings?: UseSketchDocumentResult['canvasBindings'];
};

// fallow-ignore-next-line complexity
export function SketchEditorCanvasPanel({
  canvasRef,
  canvasBindings,
  disabled,
  overlayRef,
  selectionBindings,
  activeTool,
  showBrushCursor,
  manipulationBindings,
}: SketchEditorCanvasPanelProps) {
  return (
    <div className="order-2 grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden bg-chatroom-bg-tertiary p-3 sm:p-4 lg:order-none lg:p-8">
      <canvas
        ref={canvasRef}
        width={SKETCH_CANVAS_WIDTH}
        height={SKETCH_CANVAS_HEIGHT}
        aria-label="Sketch canvas"
        className={cn(
          'col-start-1 row-start-1 block h-auto max-h-full w-auto max-w-full touch-none select-none',
          disabled
            ? 'cursor-not-allowed opacity-60'
            : showBrushCursor
              ? 'cursor-none'
              : 'cursor-crosshair',
          'ring-2 ring-chatroom-border'
        )}
        style={{ backgroundColor: SKETCH_CANVAS_BACKGROUND }}
        {...(activeTool === 'select'
          ? selectionBindings
          : activeTool === 'move' || activeTool === 'transform'
            ? manipulationBindings
            : canvasBindings)}
      />
      {overlayRef ? (
        <canvas
          ref={overlayRef}
          width={SKETCH_CANVAS_WIDTH}
          height={SKETCH_CANVAS_HEIGHT}
          aria-hidden
          data-testid="sketch-selection-overlay"
          className="pointer-events-none col-start-1 row-start-1 block h-auto max-h-full w-auto max-w-full"
        />
      ) : null}
    </div>
  );
}
