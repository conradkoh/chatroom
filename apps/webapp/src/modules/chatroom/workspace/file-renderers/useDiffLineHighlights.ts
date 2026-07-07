import { useEffect, useRef, useState } from 'react';

import { detectLanguage } from './language-detection';
import { useHighlighter } from './useHighlighter';
import type { DiffLine } from '../utils/diff-parser';

/** Strip unified-diff line prefix (+, -, or leading space). */
export function stripDiffPrefix(content: string): string {
  return /^[ +\-]/.test(content) ? content.slice(1) : content;
}

function canHighlightDiffLine(line: DiffLine, filePath: string): boolean {
  if (line.type === 'hunk') return false;
  if (line.intraSegments) return false;
  if (!detectLanguage(filePath)) return false;
  return stripDiffPrefix(line.content).length > 0;
}

const SHIKI_INLINE_CLASS =
  '[&_.shiki]:bg-transparent [&_pre]:inline [&_pre]:m-0 [&_pre]:p-0 [&_pre]:bg-transparent [&_pre]:border-0 [&_code]:text-[11px] [&_code]:font-mono';

export const diffLineHighlightClassName = SHIKI_INLINE_CLASS;

/**
 * Batch-highlights diff line contents for a single file using the shared Shiki highlighter.
 * Skips hunk headers, lines with intra-line word diffs, and unrecognized file types.
 */
export function useDiffLineHighlights(
  filePath: string,
  lines: DiffLine[]
): ReadonlyMap<number, string> {
  const { status, highlight } = useHighlighter();
  const [highlights, setHighlights] = useState<ReadonlyMap<number, string>>(new Map());
  const requestId = useRef(0);

  useEffect(() => {
    if (!filePath || status !== 'ready') {
      // eslint-disable-next-line react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- async highlight cache reset
      setHighlights(new Map());
      return;
    }

    const highlightable: { index: number; code: string }[] = [];
    lines.forEach((line, index) => {
      if (canHighlightDiffLine(line, filePath)) {
        highlightable.push({ index, code: stripDiffPrefix(line.content) });
      }
    });

    if (highlightable.length === 0) {
      // eslint-disable-next-line react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- async highlight cache reset
      setHighlights(new Map());
      return;
    }

    const id = ++requestId.current;
    let cancelled = false;

    void Promise.all(
      highlightable.map(async ({ index, code }) => {
        const html = await highlight(code, filePath);
        return { index, html };
      })
    ).then((results) => {
      if (cancelled || id !== requestId.current) return;
      const map = new Map<number, string>();
      for (const { index, html } of results) {
        map.set(index, html);
      }
      setHighlights(map);
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, lines, status, highlight]);

  return highlights;
}
