import { stripHandoffXmlTags } from './stripHandoffXmlTags';

export type WorkQueuePreviewSegment = { text: string; bold?: boolean };

const FENCED_CODE_MAX_CHARS = 80;

function appendSpace(segments: WorkQueuePreviewSegment[]): void {
  if (segments.length === 0) return;
  const last = segments[segments.length - 1];
  if (last.text && !last.text.endsWith(' ')) {
    last.text += ' ';
  }
}

function trimSegments(segments: WorkQueuePreviewSegment[]): WorkQueuePreviewSegment[] {
  while (segments.length > 0 && !segments[0].text.trim()) segments.shift();
  while (segments.length > 0 && !segments[segments.length - 1].text.trim()) segments.pop();
  return segments;
}

const INLINE_BOLD_RE = /\*\*(.+?)\*\*/g;
const INLINE_CODE_RE = /`(.+?)`/g;
const INLINE_LINK_RE = /\[([^\]]+)\]\([^)]+\)/g;
const INLINE_ITALIC_RE = /\*(.+?)\*/g;

function parseInlineSegments(
  segments: WorkQueuePreviewSegment[],
  text: string,
  opts?: { bold?: boolean }
): void {
  // Process bold markers
  let parts = text.split(INLINE_BOLD_RE);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (i % 2 === 1) {
      // Odd index = **bold** content
      const clean = part
        .replace(INLINE_CODE_RE, '$1')
        .replace(INLINE_LINK_RE, '$1')
        .replace(INLINE_ITALIC_RE, '$1');
      if (clean) segments.push({ text: clean, bold: true });
    } else {
      // Even index = non-bold
      let remaining = part;
      remaining = remaining.replace(INLINE_LINK_RE, '$1');
      remaining = remaining.replace(INLINE_CODE_RE, '$1');
      remaining = remaining.replace(INLINE_ITALIC_RE, '$1');
      if (remaining) segments.push({ text: remaining, bold: opts?.bold });
    }
  }
}

export function getWorkQueuePreviewSegments(content: string): WorkQueuePreviewSegment[] {
  let text = stripHandoffXmlTags(content);
  text = text.replace(/^---MESSAGE---\s*/m, '');
  text = text.replace(/```[\s\S]*?```/g, (block) => {
    const inner = block
      .replace(/^```\w*\n?/, '')
      .replace(/```$/, '')
      .trim();
    const firstLine = inner.split('\n')[0] ?? '';
    return firstLine.length > FENCED_CODE_MAX_CHARS
      ? firstLine.slice(0, FENCED_CODE_MAX_CHARS) + '…'
      : firstLine;
  });

  const segments: WorkQueuePreviewSegment[] = [];
  const lines = text.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      appendSpace(segments);
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      appendSpace(segments);
      parseInlineSegments(segments, heading[1], { bold: true });
      continue;
    }

    const listItem = line.match(/^[-*+]\s+(.+)$/);
    if (listItem) {
      appendSpace(segments);
      segments.push({ text: '• ' });
      parseInlineSegments(segments, listItem[1]);
      continue;
    }

    parseInlineSegments(segments, line);
  }

  return trimSegments(segments);
}

export function formatWorkQueuePreviewPlainText(segments: WorkQueuePreviewSegment[]): string {
  return segments
    .map((s) => s.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
