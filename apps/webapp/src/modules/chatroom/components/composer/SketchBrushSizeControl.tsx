'use client';

import {
  SKETCH_BRUSH_SIZE_MAX,
  SKETCH_BRUSH_SIZE_MIN,
  SKETCH_BRUSH_SIZE_STEP,
} from './sketchConstants';

export function SketchBrushSizeControl({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (size: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sketch-brush-size" className="text-[11px] text-chatroom-text-muted">
        Size
      </label>
      <input
        id="sketch-brush-size"
        type="range"
        min={SKETCH_BRUSH_SIZE_MIN}
        max={SKETCH_BRUSH_SIZE_MAX}
        step={SKETCH_BRUSH_SIZE_STEP}
        value={value}
        disabled={disabled}
        aria-valuetext={`${value} pixels`}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-20 cursor-pointer accent-chatroom-accent disabled:cursor-not-allowed disabled:opacity-40"
      />
      <span className="w-6 text-[11px] text-chatroom-text-muted">{value}px</span>
    </div>
  );
}
