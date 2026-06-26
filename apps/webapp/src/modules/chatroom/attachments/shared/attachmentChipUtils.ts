/** Truncate text to a maximum length with ellipsis. */
function truncateAttachmentChipText(text: string, maxLength = 30): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}

/** Strip leading markdown heading syntax (# characters) from a line. */
function stripAttachmentMarkdownHeading(line: string): string {
  return line.replace(/^#+\s*/, '');
}

/** First non-empty line of attachment content, with heading markers stripped. */
export function getAttachmentChipPreviewLine(content: string): {
  firstLine: string;
  displayText: string;
} {
  const rawFirstLine = content.split('\n').find((line) => line.trim()) || content;
  const firstLine = stripAttachmentMarkdownHeading(rawFirstLine);
  return { firstLine, displayText: truncateAttachmentChipText(firstLine) };
}
