// fallow-ignore-file complexity
// fallow-ignore-next-line unused-export
export function insertTextAtCaret(
  currentText: string,
  caretPos: number,
  insertion: string
): { newText: string; newCursorPos: number } {
  const pos = Math.max(0, Math.min(caretPos, currentText.length));
  const before = currentText.slice(0, pos);
  const after = currentText.slice(pos);
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
  const token = `${needsLeadingSpace ? ' ' : ''}${insertion}${needsTrailingSpace ? ' ' : ''}`;
  const newText = before + token + after;
  return { newText, newCursorPos: before.length + token.length };
}

export function insertMultipleAtCaret(
  currentText: string,
  caretPos: number,
  insertions: string[]
): { newText: string; newCursorPos: number } {
  if (insertions.length === 0) return { newText: currentText, newCursorPos: caretPos };
  return insertTextAtCaret(currentText, caretPos, insertions.join(' '));
}
