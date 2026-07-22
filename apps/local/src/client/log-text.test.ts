import { describe, it, expect } from 'vitest';

import { parseLogTextSegments, splitUrls, stripAnsi } from './log-text';

describe('stripAnsi', () => {
  it('removes ANSI color codes', () => {
    expect(stripAnsi('\x1b[32m✔\x1b[39m Convex functions ready!')).toBe(
      '✔ Convex functions ready!'
    );
  });
});

describe('parseLogTextSegments', () => {
  it('parses green success text', () => {
    const segments = parseLogTextSegments('\x1b[32m✔\x1b[39m Convex functions ready! (3.71s)');
    expect(segments).toEqual([
      { text: '✔', color: 'var(--chatroom-status-success)', bold: false },
      { text: ' Convex functions ready! (3.71s)', bold: false },
    ]);
  });
});

describe('splitUrls', () => {
  it('splits localhost URLs into linkable parts', () => {
    expect(splitUrls('- Local: http://localhost:3000')).toEqual([
      { type: 'text', value: '- Local: ' },
      { type: 'url', value: 'http://localhost:3000' },
    ]);
  });
});
