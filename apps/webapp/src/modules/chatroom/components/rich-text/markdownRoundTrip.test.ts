/**
 * Markdown round-trip tests for tiptap.
 *
 * These tests verify that common markdown constructs survive serialization
 * and deserialization through the editor.
 *
 * Known limitations (not tested):
 * - GFM tables (| col1 | col2 |) — may not round-trip
 * - Task lists (- [ ] / - [x]) — may not round-trip
 * - Strikethrough (~~text~~) — not in starter-kit by default
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';

import { renderRichTextEditor, waitForEditor } from './test-utils';

function normalize(str: string): string {
  return str.replace(/\r\n/g, '\n').trim();
}

const SAMPLES: { name: string; md: string }[] = [
  {
    name: 'heading + paragraph',
    md: '# Title\n\nThis is a paragraph with **bold** and *italic* text.',
  },
  {
    name: 'bullet list',
    md: '- Item one\n- Item two\n- Item three',
  },
  {
    name: 'ordered list',
    md: '1. First\n2. Second\n3. Third',
  },
  {
    name: 'code block',
    md: '```\nconst x = 1;\nconsole.log(x);\n```',
  },
  {
    name: 'inline code + link',
    md: 'Use `npx tsc` to check types. Read more at [example](https://example.com).',
  },
  {
    name: 'blockquote',
    md: '> This is a blockquote.',
  },
  {
    name: 'mixed content',
    md: '## Section\n\nThis has **bold**, *italic*, and `code`.\n\n- List item\n- Another item\n\n```json\n{"key": "value"}\n```',
  },
];

describe('markdown round trip', () => {
  for (const sample of SAMPLES) {
    it(`round-trips: ${sample.name}`, async () => {
      const { result } = await waitForEditor(sample.md);
      expect(normalize(result)).toBe(normalize(sample.md));
    });
  }
});
