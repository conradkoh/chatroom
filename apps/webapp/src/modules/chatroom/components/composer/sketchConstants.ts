/** MVP export contract: sketches are opaque white PNGs and do not change with app theme. */
/** MVP export contract: sketches are opaque white PNGs and do not change with app theme.
 * Internal editor layers use transparent bitmaps; only the composite/export surface is white. */
export const SKETCH_CANVAS_BACKGROUND = '#ffffff' as const;
/** Stable 4:3 logical/export surface; CSS scales it without stretching. */
export const SKETCH_CANVAS_WIDTH = 1200;
export const SKETCH_CANVAS_HEIGHT = 900;

export const SKETCH_BRUSH_PALETTE = [
  { label: 'Black', value: '#171717' },
  { label: 'Red', value: '#ef4444' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Yellow', value: '#eab308' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Pink', value: '#ec4899' },
] as const;

export type SketchBrushColor = (typeof SKETCH_BRUSH_PALETTE)[number]['value'];
export const SKETCH_BRUSH_SIZE_MIN = 1;
export const SKETCH_BRUSH_SIZE_MAX = 32;
export const SKETCH_BRUSH_SIZE_DEFAULT = 3;
export const SKETCH_BRUSH_SIZE_STEP = 1;
export const SKETCH_BRUSH_COLOR_DEFAULT: SketchBrushColor = '#171717';
