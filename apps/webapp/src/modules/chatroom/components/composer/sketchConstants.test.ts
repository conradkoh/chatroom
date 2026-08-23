import { describe, expect, it } from 'vitest';
import { SKETCH_BRUSH_COLOR_DEFAULT, SKETCH_BRUSH_PALETTE, SKETCH_BRUSH_SIZE_MAX, SKETCH_BRUSH_SIZE_MIN, SKETCH_CANVAS_BACKGROUND } from './sketchConstants';
describe('sketch constants', () => { it('defines the opaque MVP canvas and palette', () => { expect(SKETCH_CANVAS_BACKGROUND).toBe('#ffffff'); expect(SKETCH_BRUSH_PALETTE).toHaveLength(8); expect(SKETCH_BRUSH_COLOR_DEFAULT).toBe('#171717'); }); it('keeps size bounds', () => { expect(SKETCH_BRUSH_SIZE_MIN).toBe(1); expect(SKETCH_BRUSH_SIZE_MAX).toBe(32); }); });
