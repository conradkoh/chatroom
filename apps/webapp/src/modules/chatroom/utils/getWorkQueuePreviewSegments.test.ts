import { describe, expect, it } from 'vitest';

import {
  getWorkQueuePreviewSegments,
  formatWorkQueuePreviewPlainText,
} from './getWorkQueuePreviewSegments';

describe('getWorkQueuePreviewSegments', () => {
  it('parses heading as bold segment', () => {
    const segs = getWorkQueuePreviewSegments('## Summary\nFoo');
    expect(segs[0].bold).toBe(true);
    expect(segs[0].text).toBe('Summary');
  });

  it('renders link as plain text', () => {
    const segs = getWorkQueuePreviewSegments('[click](https://x.com)');
    const text = formatWorkQueuePreviewPlainText(segs);
    expect(text).toContain('click');
    expect(text).not.toContain('https://');
  });

  it('renders italic as regular text', () => {
    const segs = getWorkQueuePreviewSegments('*italic*');
    expect(segs.some((s) => s.text === 'italic')).toBe(true);
    expect(segs.some((s) => s.bold)).toBe(false);
  });

  it('renders inline code as plain text', () => {
    const segs = getWorkQueuePreviewSegments('use `code` here');
    const text = formatWorkQueuePreviewPlainText(segs);
    expect(text).toContain('use code here');
  });

  it('strips handoff XML tags', () => {
    const input = '<handoff-overview>## Summary\nFoo</handoff-overview>';
    const text = formatWorkQueuePreviewPlainText(getWorkQueuePreviewSegments(input));
    expect(text).toContain('Summary');
    expect(text).not.toContain('<handoff-');
  });

  it('fenced code block is truncated to 80 chars', () => {
    const longCode = '```\n' + 'x'.repeat(200) + '\n```';
    const segs = getWorkQueuePreviewSegments(longCode);
    const text = formatWorkQueuePreviewPlainText(segs);
    expect(text).toHaveLength(81); // 80 chars + …
    expect(text.endsWith('…')).toBe(true);
  });

  it('formats list items with bullet', () => {
    const segs = getWorkQueuePreviewSegments('- Item one\n- Item two');
    const text = formatWorkQueuePreviewPlainText(segs);
    expect(text).toContain('• Item one');
    expect(text).toContain('• Item two');
  });

  it('collapses whitespace to single space', () => {
    const segs = getWorkQueuePreviewSegments('Line 1\n\n\nLine 2');
    const text = formatWorkQueuePreviewPlainText(segs);
    expect(text).toBe('Line 1 Line 2');
  });

  it('no ## in plain text output', () => {
    const text = formatWorkQueuePreviewPlainText(getWorkQueuePreviewSegments('## Not shown'));
    expect(text).not.toContain('##');
    expect(text).toBe('Not shown');
  });

  it('strips legacy HTML and renders plain text', () => {
    const text = formatWorkQueuePreviewPlainText(
      getWorkQueuePreviewSegments('<p>Hello <strong>world</strong></p>')
    );
    expect(text).toBe('Hello world');
    expect(text).not.toContain('<p');
  });
});
