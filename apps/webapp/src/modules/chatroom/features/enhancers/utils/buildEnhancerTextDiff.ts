import { diffLines } from 'diff';

import type {
  EnhancerSplitDiffLine,
  EnhancerTextDiff,
  EnhancerUnifiedDiffLine,
} from '../types/enhancerDiff';

function splitChangeLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Builds unified and split diff representations from original vs enhanced text.
 * Uses line-level diff suitable for markdown handoff content.
 */
export function buildEnhancerTextDiff(original: string, enhanced: string): EnhancerTextDiff {
  const changes = diffLines(original, enhanced, { newlineIsToken: true });

  const unified: EnhancerUnifiedDiffLine[] = [];
  const beforeLines: EnhancerSplitDiffLine[] = [];
  const afterLines: EnhancerSplitDiffLine[] = [];

  let beforeLineNum = 1;
  let afterLineNum = 1;

  for (const change of changes) {
    for (const line of splitChangeLines(change.value)) {
      if (change.added) {
        unified.push({ type: 'addition', content: line });
        beforeLines.push({ type: 'empty', content: '' });
        afterLines.push({ type: 'addition', content: line, lineNumber: afterLineNum++ });
      } else if (change.removed) {
        unified.push({ type: 'deletion', content: line });
        beforeLines.push({ type: 'deletion', content: line, lineNumber: beforeLineNum++ });
        afterLines.push({ type: 'empty', content: '' });
      } else {
        unified.push({ type: 'unchanged', content: line });
        beforeLines.push({ type: 'unchanged', content: line, lineNumber: beforeLineNum++ });
        afterLines.push({ type: 'unchanged', content: line, lineNumber: afterLineNum++ });
      }
    }
  }

  return {
    unified,
    split: {
      before: { label: 'Before', lines: beforeLines },
      after: { label: 'After', lines: afterLines },
    },
  };
}
