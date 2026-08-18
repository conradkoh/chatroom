import { describe, expect, it } from 'vitest';

import { getVisualLines, visualLineBoundaryTarget } from './codeBlockVisualLines';

describe('code block visual line mapping', () => {
  it('maps three wrapped spans with boundaries on the next row', () => {
    const coordsAtPos = (pos: number) => ({
      top: pos < 4 ? 10 : pos < 7 ? 30 : 50,
    });
    const lines = getVisualLines(coordsAtPos, 1, 9);

    expect(lines).toEqual([
      { start: 1, end: 4, top: 10 },
      { start: 4, end: 7, top: 30 },
      { start: 7, end: 9, top: 50 },
    ]);
    expect(visualLineBoundaryTarget(lines, 9, 'backward')).toBe(7);
    expect(visualLineBoundaryTarget(lines, 7, 'backward')).toBeNull();
  });

  it('moves forward to the current line end and no-ops at block end', () => {
    const lines = [
      { start: 1, end: 4, top: 10 },
      { start: 4, end: 7, top: 30 },
    ];

    expect(visualLineBoundaryTarget(lines, 5, 'forward')).toBe(7);
    expect(visualLineBoundaryTarget(lines, 7, 'forward')).toBeNull();
  });

  it('supports an empty block', () => {
    const lines = getVisualLines(() => ({ top: 10 }), 4, 4);

    expect(lines).toEqual([{ start: 4, end: 4, top: 10 }]);
    expect(visualLineBoundaryTarget(lines, 4, 'backward')).toBeNull();
  });

  it('splits at a logical newline and includes the trailing position', () => {
    const coordsAtPos = (pos: number) => ({ top: pos <= 3 ? 10 : 30 });
    const lines = getVisualLines(coordsAtPos, 1, 5);

    expect(lines).toEqual([
      { start: 1, end: 4, top: 10 },
      { start: 4, end: 5, top: 30 },
    ]);
    expect(visualLineBoundaryTarget(lines, 5, 'backward')).toBe(4);
  });

  it('backward from blockEnd succeeds when WebKit reports mismatched terminal top', () => {
    const coordsAtPos = (pos: number) => ({
      top: pos < 7 ? 10 : pos < 9 ? 50 : 80,
    });
    const lines = getVisualLines(coordsAtPos, 1, 9, { charBeforeBlockEnd: ']' });

    expect(lines).toEqual([
      { start: 1, end: 7, top: 10 },
      { start: 7, end: 9, top: 50 },
    ]);
    expect(visualLineBoundaryTarget(lines, 9, 'backward')).toBe(7);
  });

  it('preserves a genuine trailing blank line after logical newline', () => {
    const coordsAtPos = (pos: number) => ({ top: pos <= 4 ? 10 : 30 });
    const lines = getVisualLines(coordsAtPos, 1, 5, { charBeforeBlockEnd: '\n' });

    expect(lines).toEqual([
      { start: 1, end: 5, top: 10 },
      { start: 5, end: 5, top: 30 },
    ]);
    expect(visualLineBoundaryTarget(lines, 5, 'backward')).toBeNull();
  });
});
