import { describe, expect, it } from 'vitest';

import { formatLogLineAsXml } from './log-line-xml';
import type { LogLine, LogMetadata } from '../api/types';

/** Every character the output is allowed to contain (validated by the ASCII test). */
const ASCII_ONLY = /^[\x09\x0A\x0D\x20-\x7E]*$/;

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
