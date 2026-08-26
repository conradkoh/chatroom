'use client';
import { SKETCH_BRUSH_PALETTE, type SketchBrushColor } from './sketchConstants';

export function SketchColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: SketchBrushColor;
  onChange: (color: SketchBrushColor) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-labelledby="sketch-brush-color-label"
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      <span id="sketch-brush-color-label" className="mr-1 text-[11px] text-chatroom-text-muted">
        Color
      </span>
      {SKETCH_BRUSH_PALETTE.map(({ label, value: color }) => (
        <button
          key={color}
          type="button"
          aria-label={`Brush color ${label}`}
          aria-pressed={value === color}
          disabled={disabled}
          onClick={() => onChange(color)}
          style={{ backgroundColor: color }}
          className="size-10 cursor-pointer rounded-none border border-chatroom-border-strong disabled:cursor-not-allowed disabled:opacity-40 sm:size-8"
        />
      ))}
    </div>
  );
}
