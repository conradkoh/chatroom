export interface TextRange {
  start: number;
  end: number;
}

const MAX_NEEDLE_LENGTH = 200;

/**
 * Finds all exact (case-sensitive) non-overlapping-adjacent occurrences of `needle` in `content`.
 * Overlapping matches are included (e.g. "aa" in "aaaa" → positions 0 and 1).
 */
// fallow-ignore-next-line complexity
export function findExactMatches(content: string, needle: string): TextRange[] {
  if (!needle || needle.length > MAX_NEEDLE_LENGTH) {
    return [];
  }

  const matches: TextRange[] = [];
  let index = 0;

  while (index <= content.length - needle.length) {
    const found = content.indexOf(needle, index);
    if (found === -1) {
      break;
    }
    matches.push({ start: found, end: found + needle.length });
    index = found + 1;
  }

  return matches;
}

export function excludeActiveSelection(
  matches: readonly TextRange[],
  selection: TextRange | null
): TextRange[] {
  if (!selection) {
    return [...matches];
  }

  return matches.filter((match) => match.start !== selection.start || match.end !== selection.end);
}
