import { Fragment, type ReactNode } from 'react';

import type { TextRange } from './findExactMatches';

// fallow-ignore-next-line complexity
export function buildMirrorHighlightSegments(
  content: string,
  highlightRanges: readonly TextRange[]
): ReactNode {
  if (highlightRanges.length === 0) {
    return content;
  }

  const sorted = [...highlightRanges].sort((a, b) => a.start - b.start);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const range of sorted) {
    if (range.start > cursor) {
      nodes.push(<Fragment key={`text-${cursor}`}>{content.slice(cursor, range.start)}</Fragment>);
    }

    if (range.end > range.start) {
      nodes.push(
        <mark
          key={`mark-${range.start}-${range.end}`}
          className="selection-match-highlight rounded-sm bg-amber-200/50 text-chatroom-text-primary dark:bg-amber-700/30"
        >
          {content.slice(range.start, range.end)}
        </mark>
      );
    }

    cursor = Math.max(cursor, range.end);
  }

  if (cursor < content.length) {
    nodes.push(<Fragment key={`text-${cursor}`}>{content.slice(cursor)}</Fragment>);
  }

  return nodes;
}
