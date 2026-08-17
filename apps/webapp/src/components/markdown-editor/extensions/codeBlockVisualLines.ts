export type VisualLine = { start: number; end: number; top: number };

type Coords = { top: number };

export type GetVisualLinesOptions = {
  /** Character immediately before blockEnd; used to preserve a trailing blank line. */
  charBeforeBlockEnd?: string;
};

const TOP_EPSILON = 0.5;

export function getVisualLines(
  coordsAtPos: (pos: number, side?: number) => Coords,
  blockStart: number,
  blockEnd: number,
  options?: GetVisualLinesOptions
): VisualLine[] {
  if (blockStart > blockEnd) return [];

  const lines: VisualLine[] = [];
  let currentStart = blockStart;
  let currentTop = coordsAtPos(blockStart, 1).top;

  for (let pos = blockStart + 1; pos <= blockEnd; pos += 1) {
    const top = coordsAtPos(pos, pos === blockEnd ? -1 : 1).top;
    if (Math.abs(top - currentTop) > TOP_EPSILON) {
      lines.push({ start: currentStart, end: pos, top: currentTop });
      currentStart = pos;
      currentTop = top;
    }
  }

  lines.push({ start: currentStart, end: blockEnd, top: currentTop });

  // Every span contains valid ProseMirror cursor positions. The final span includes blockEnd.
  // WebKit can report blockEnd on a separate terminal row; absorb that orphan unless the
  // character before blockEnd is a newline, which represents a genuine trailing blank line.
  if (
    lines.length > 1 &&
    blockEnd > blockStart &&
    options?.charBeforeBlockEnd !== '\n'
  ) {
    const last = lines[lines.length - 1];
    const previous = lines[lines.length - 2];
    if (last.start === last.end && last.end === blockEnd) {
      lines.pop();
      previous.end = blockEnd;
    }
  }

  return lines;
}

export function findVisualLineForPos(lines: VisualLine[], pos: number): VisualLine | null {
  const lastIndex = lines.length - 1;
  return (
    lines.find(
      (line, index) =>
        pos >= line.start && (pos < line.end || (index === lastIndex && pos === line.end))
    ) ?? null
  );
}

export type LineDirection = 'backward' | 'forward';

export function visualLineBoundaryTarget(
  lines: VisualLine[],
  head: number,
  direction: LineDirection
): number | null {
  const currentLine = findVisualLineForPos(lines, head);
  if (!currentLine) return null;

  if (direction === 'backward') {
    return head > currentLine.start ? currentLine.start : null;
  }

  return head < currentLine.end ? currentLine.end : null;
}
