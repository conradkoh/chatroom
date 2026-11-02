import { describe, expect, it } from 'vitest';

import { formatLogLineAsXml } from './log-line-xml';
import type { LogLine, LogMetadata } from '../api/types';

/** Every character the output is allowed to contain (validated by the ASCII test). */
const ASCII_ONLY = /^[\x09\x0A\x0D\x20-\x7E]*$/;

/** Matches every numeric character reference the formatter can emit. */
const NUMERIC_CHARACTER_REFERENCE = /&#x([0-9A-F]+);/g;

/**
 * XML 1.0 `Char` production, duplicated deliberately: the test must fail if the
 * formatter starts emitting references to code points a parser rejects.
 */
function isLegalXmlChar(codePoint: number): boolean {
  return (
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

/** Numeric references in `xml` whose code point is not a legal XML 1.0 Char. */
function illegalCodePointReferences(xml: string): string[] {
  return [...xml.matchAll(NUMERIC_CHARACTER_REFERENCE)]
    .map((match) => `&#x${match[1]};`)
    .filter((reference) => {
      const codePoint = Number.parseInt(reference.slice(3, -1), 16);
      return !isLegalXmlChar(codePoint);
    });
}

describe('formatLogLineAsXml', () => {
  it('renders every field of a full log line', () => {
    const line: LogLine = {
      id: 42,
      timestamp: Date.UTC(2026, 10, 2, 8, 15, 30, 123),
      level: 'error',
      source: 'harness:claude',
      stream: 'stderr',
      message: 'Something failed & retried',
      metadata: {
        chatroomId: 'jn7cs34n59xbdvrpww8wnwsztd8heqq2',
        role: 'builder',
        pid: 1234,
        harness: 'claude',
      },
    };

    expect(formatLogLineAsXml(line, 'Dev room')).toBe(
      `<?xml version="1.0" encoding="US-ASCII"?>
<logLine>
  <id>42</id>
  <timestamp>2026-11-02T08:15:30.123Z</timestamp>
  <level>error</level>
  <source>harness:claude</source>
  <stream>stderr</stream>
  <chatroom name="Dev room">jn7cs34n59xbdvrpww8wnwsztd8heqq2</chatroom>
  <role>builder</role>
  <harness>claude</harness>
  <message>Something failed &amp; retried</message>
  <metadata>
    <field name="pid">1234</field>
  </metadata>
</logLine>
`
    );
  });

  it('omits optional elements for a minimal log line', () => {
    const line: LogLine = {
      timestamp: Date.UTC(2026, 0, 1, 0, 0, 0),
      level: 'info',
      source: 'daemon',
      message: 'started',
    };

    expect(formatLogLineAsXml(line)).toBe(
      `<?xml version="1.0" encoding="US-ASCII"?>
<logLine>
  <timestamp>2026-01-01T00:00:00.000Z</timestamp>
  <level>info</level>
  <source>daemon</source>
  <message>started</message>
</logLine>
`
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1e16])(
    'omits the timestamp element when the timestamp is %s',
    (timestamp) => {
      const line: LogLine = {
        timestamp,
        level: 'info',
        source: 'daemon',
        message: 'm',
      };

      expect(formatLogLineAsXml(line)).toBe(
        `<?xml version="1.0" encoding="US-ASCII"?>
<logLine>
  <level>info</level>
  <source>daemon</source>
  <message>m</message>
</logLine>
`
      );
    }
  );

  it('escapes XML metacharacters in the message', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'warn',
      source: 'daemon',
      message: `A & B < C > D " E ' F`,
    };

    expect(formatLogLineAsXml(line)).toContain(
      `<message>A &amp; B &lt; C &gt; D &quot; E &apos; F</message>`
    );
  });

  it('escapes XML metacharacters in metadata field values', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'warn',
      source: 'daemon',
      message: 'm',
      metadata: { note: `x & y < z > "q" 'r'` } as LogMetadata,
    };

    expect(formatLogLineAsXml(line)).toContain(
      `<field name="note">x &amp; y &lt; z &gt; &quot;q&quot; &apos;r&apos;</field>`
    );
  });

  it('emits non-ASCII characters as numeric references and stays pure ASCII', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: `caf\u00e9 \u{1F600}`,
    };

    const xml = formatLogLineAsXml(line);

    expect(xml).toContain('<message>caf&#xE9; &#x1F600;</message>');
    expect(ASCII_ONLY.test(xml)).toBe(true);
    for (const char of xml) {
      expect(char.codePointAt(0) ?? 0).toBeLessThanOrEqual(0x7e);
    }
  });

  it('encodes carriage returns while preserving newlines and tabs in the message', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'line1\r\nline2\ttab',
    };

    const xml = formatLogLineAsXml(line);

    expect(xml).toContain('<message>line1&#xD;\nline2\ttab</message>');
    expect(xml).not.toContain('\r');
  });

  it('replaces code points that XML 1.0 does not allow with U+FFFD', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'esc:\u001b nul:\u0000 surrogate:\uD800',
    };

    const xml = formatLogLineAsXml(line);

    expect(xml).toContain('<message>esc:&#xFFFD; nul:&#xFFFD; surrogate:&#xFFFD;</message>');
    expect(illegalCodePointReferences(xml)).toEqual([]);
    expect(ASCII_ONLY.test(xml)).toBe(true);
  });

  it('strips ANSI escape sequences from the message', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'before \u001b[1;31mred\u001b[0m after',
    };

    expect(formatLogLineAsXml(line)).toContain('<message>before red after</message>');
  });

  it('strips OSC hyperlink sequences from the message', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'link: \u001b]8;;https://example.com\u0007text\u001b]8;;\u0007',
    };

    expect(formatLogLineAsXml(line)).toContain('<message>link: text</message>');
  });

  it('never emits a reference to a code point outside the XML 1.0 Char production', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'a\u0000b\u0008c\u000Bd\u000Ce\u001Bf\uD800g\uFFFEx\uFFFFy\u007Fz',
    };

    const xml = formatLogLineAsXml(line);

    expect(xml).toContain(
      '<message>a&#xFFFD;b&#xFFFD;c&#xFFFD;d&#xFFFD;e&#xFFFD;f&#xFFFD;g&#xFFFD;x&#xFFFD;y&#x7F;z</message>'
    );
    expect(illegalCodePointReferences(xml)).toEqual([]);
    expect(ASCII_ONLY.test(xml)).toBe(true);
  });

  it('encodes newlines and tabs inside attribute values', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'm',
      metadata: { chatroomId: 'abc123' },
    };

    expect(formatLogLineAsXml(line, 'Dev\nroom\tx')).toContain(
      '<chatroom name="Dev&#xA;room&#x9;x">abc123</chatroom>'
    );
  });

  it('sanitises ANSI sequences and illegal code points in the chatroom name attribute', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'm',
      metadata: { chatroomId: 'abc123' },
    };

    expect(formatLogLineAsXml(line, 'Dev\u001b[31mX\u0000')).toContain(
      '<chatroom name="DevX&#xFFFD;">abc123</chatroom>'
    );
  });

  it('sanitises ANSI sequences and illegal code points in metadata field names', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'm',
      metadata: { 'k\u001b[31mk\u0000': 1 } as LogMetadata,
    };

    expect(formatLogLineAsXml(line)).toContain('<field name="kk&#xFFFD;">1</field>');
  });

  it('escapes XML metacharacters in metadata field names', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'm',
      metadata: { 'a&b': 1, 'x"y<z': 2 } as LogMetadata,
    };

    const xml = formatLogLineAsXml(line);

    expect(xml).toContain('<field name="a&amp;b">1</field>');
    expect(xml).toContain('<field name="x&quot;y&lt;z">2</field>');
  });

  it('uses the provided chatroom name with the chatroom id', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'm',
      metadata: { chatroomId: 'abc123' },
    };

    expect(formatLogLineAsXml(line, 'Dev room')).toContain(
      '<chatroom name="Dev room">abc123</chatroom>'
    );
  });

  it('falls back to the chatroom id when no name is provided', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'm',
      metadata: { chatroomId: 'abc123' },
    };

    const xml = formatLogLineAsXml(line);

    expect(xml).toContain('<chatroom>abc123</chatroom>');
    expect(xml).not.toContain('<chatroom name=');
  });

  it('omits the chatroom element when there is neither a name nor an id', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'm',
    };

    expect(formatLogLineAsXml(line)).not.toContain('<chatroom');
  });

  it('serialises object metadata values as escaped JSON', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'm',
      metadata: { payload: { a: 1, b: 'x&y' } } as LogMetadata,
    };

    expect(formatLogLineAsXml(line)).toContain(
      '<field name="payload">{&quot;a&quot;:1,&quot;b&quot;:&quot;x&amp;y&quot;}</field>'
    );
  });

  it('does not mutate the input line', () => {
    const line: LogLine = {
      timestamp: 0,
      level: 'info',
      source: 'daemon',
      message: 'm',
      metadata: { pid: 1 },
    };
    const snapshot = structuredClone(line);

    formatLogLineAsXml(line, 'Dev room');

    expect(line).toEqual(snapshot);
  });
});
