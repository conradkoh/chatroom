export type VisualLine = { start: number; end: number; top: number };

type Coords = { top: number };

const TOP_EPSILON = 0.5;

export function getVisualLines(
  coordsAtPos: (pos: number) => Coords,
  blockStart: number,
  blockEnd: number
): VisualLine[] {
  if (blockStart > blockEnd) return [];

  const lines: VisualLine[] = [];
  let currentStart = blockStart;
  let currentTop = coordsAtPos(blockStart).top;

  for (let pos = blockStart + 1; pos <= blockEnd; pos += 1) {
    const top = coordsAtPos(pos).top;
    if (Math.abs(top - currentTop) > TOP_EPSILON) {
      lines.push({ start: currentStart, end: pos, top: currentTop });
      currentStart = pos;
      currentTop = top;
    }
  }

  lines.push({ start: currentStart, end: blockEnd, top: currentTop });
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
