import { describe, expect, it } from 'vitest';
import { buildSketchFileName } from './sketchFileName';
describe('buildSketchFileName', () => {
  it('formats a deterministic timestamp', () => {
    expect(buildSketchFileName(new Date(2026, 7, 16, 12, 0, 0))).toBe('sketch-20260816-120000.png');
  });
});
