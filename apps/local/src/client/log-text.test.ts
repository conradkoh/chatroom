import { describe, it, expect } from 'vitest';

import {
  collectUrlsFromLogLines,
  extractFirstUrl,
  extractUrls,
  isLocalUrl,
  parseLogTextSegments,
  splitUrls,
  stripAnsi,
} from './log-text';

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

describe('extractFirstUrl', () => {
  it('returns the first URL in a line', () => {
    expect(extractFirstUrl('- Local: http://localhost:3000 http://localhost:4000')).toBe(
      'http://localhost:3000'
    );
  });

  it('extracts URLs from ANSI-colored log lines', () => {
    expect(extractFirstUrl('\x1b[32mReady\x1b[39m at http://localhost:3000')).toBe(
      'http://localhost:3000'
    );
  });
});

describe('isLocalUrl', () => {
  it('accepts localhost and loopback hosts', () => {
    expect(isLocalUrl('http://localhost:3000')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:3210')).toBe(true);
    expect(isLocalUrl('http://[::1]:8080')).toBe(true);
  });

  it('rejects remote hosts', () => {
    expect(isLocalUrl('https://happy-animal-123.convex.cloud')).toBe(false);
    expect(isLocalUrl('https://unpkg.com/react-grab')).toBe(false);
  });
});

describe('collectUrlsFromLogLines', () => {
  it('collects unique local URLs in discovery order', () => {
    const urls = collectUrlsFromLogLines([
      { text: 'Local: http://localhost:3000' },
      { text: 'Dashboard: http://localhost:3000' },
      { text: 'Convex: http://127.0.0.1:3210' },
    ]);

    expect(urls).toEqual(['http://localhost:3000', 'http://127.0.0.1:3210']);
  });

  it('ignores remote URLs and still collects local URLs on the same line', () => {
    const urls = collectUrlsFromLogLines([
      {
        text: 'Deploy https://happy-animal-123.convex.cloud then open http://localhost:6249',
      },
    ]);

    expect(urls).toEqual(['http://localhost:6249']);
  });

  it('extracts all local URLs from a line, not only the first match', () => {
    expect(
      extractUrls('http://localhost:3000 and http://127.0.0.1:3210 https://example.com')
    ).toEqual(['http://localhost:3000', 'http://127.0.0.1:3210', 'https://example.com']);
  });
});
