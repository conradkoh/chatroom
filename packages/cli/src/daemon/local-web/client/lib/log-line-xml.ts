import { getLogChatroomId, getLogHarness, getLogRole } from './log-line.js';
import type { LogLine } from '../api/types.js';

/** Metadata keys that already have their own dedicated element in the document. */
const RESERVED_METADATA_KEYS = new Set(['chatroomId', 'role', 'harness']);

/** U+FFFD REPLACEMENT CHARACTER, written as a reference so the output stays ASCII. */
const REPLACEMENT_CHARACTER_REFERENCE = '&#xFFFD;';

/**
 * OSC and CSI escape sequences, matching the rules in
 * `packages/cli/src/utils/terminal-safety.ts`. `sanitizeForTerminal` itself is
 * not reused here because it also deletes every C0/C1 control character and
 * normalises CR to LF, whereas this formatter must preserve tab/LF/CR
 * semantics and replace other illegal code points with U+FFFD.
 */
const ANSI_OSC_SEQUENCE = /\u001B\][^\u0007\u001B\u009C]*(?:\u0007|\u001B\\|\u009C)/g;
const ANSI_CSI_SEQUENCE = /\u001B\[[0-?]*[ -/]*[@-~]/g;

/**
 * Remove ANSI escape sequences before escaping.
 *
 * Harness stdout is logged raw, so coloured output arrives with ESC (0x1B)
 * still in the text. ESC is not a legal XML 1.0 Char, so leaving it in would
 * make the copied document fail to parse.
 */
function stripAnsiSequences(value: string): string {
  return value.replace(ANSI_OSC_SEQUENCE, '').replace(ANSI_CSI_SEQUENCE, '');
}

/**
 * XML 1.0 `Char` production: the only code points a numeric reference may name.
 * Anything else is a fatal parse error, so it must not be emitted.
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

/**
 * Escape a string so the result is safe to embed in XML character data.
 *
 * The output is guaranteed to be pure ASCII: characters outside printable
 * ASCII (0x20-0x7E), plus control characters other than `\n` and `\t`, are
 * emitted as uppercase-hex numeric character references. `\n` and `\t` are
 * preserved verbatim so multi-line messages keep their shape. Code points that
 * XML 1.0 does not allow (control characters, lone surrogates, U+FFFE/U+FFFF)
 * are emitted as U+FFFD instead of an illegal reference.
 */
function escapeXmlText(value: string): string {
  let out = '';
  // Iterating a string yields code points, so astral characters (emoji) are
  // emitted as a single reference rather than two surrogate escapes.
  for (const char of stripAnsiSequences(value)) {
    switch (char) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case "'":
        out += '&apos;';
        break;
      case '\n':
        out += '\n';
        break;
      case '\t':
        out += '\t';
        break;
      default:
        out += escapeCodePoint(char);
    }
  }
  return out;
}

/**
 * Escape a string for use inside a double-quoted XML attribute.
 *
 * Differs from {@link escapeXmlText} only in that `\n` and `\t` become numeric
 * references, because XML parsers collapse literal whitespace in attribute
 * values.
 */
function escapeXmlAttribute(value: string): string {
  let out = '';
  for (const char of stripAnsiSequences(value)) {
    switch (char) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case "'":
        out += '&apos;';
        break;
      default:
        out += escapeCodePoint(char);
    }
  }
  return out;
}

function escapeCodePoint(char: string): string {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint >= 0x20 && codePoint <= 0x7e) {
    return char;
  }
  if (!isLegalXmlChar(codePoint)) {
    return REPLACEMENT_CHARACTER_REFERENCE;
  }
  return `&#x${codePoint.toString(16).toUpperCase()};`;
}

function metadataValueToString(value: unknown): string | undefined {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return String(value);
    case 'undefined':
      return undefined;
    default:
      return JSON.stringify(value);
  }
}

function renderElement(indent: string, name: string, value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return [`${indent}<${name}>${escapeXmlText(value)}</${name}>`];
}

/**
 * Format a log line as a well-formatted, ASCII-only XML document.
 *
 * Timestamps are always ISO 8601 in UTC so copied reports are machine-stable
 * regardless of the browser's timezone. Optional elements are omitted when
 * their value is absent, and metadata keys that already have a dedicated
 * element (`chatroomId`, `role`, `harness`) are skipped so they are not
 * duplicated.
 */
export function formatLogLineAsXml(line: LogLine, chatroomName?: string): string {
  const chatroomId = getLogChatroomId(line);
  const lines: string[] = ['<?xml version="1.0" encoding="US-ASCII"?>', '<logLine>'];

  if (line.id != null) {
    lines.push(...renderElement('  ', 'id', String(line.id)));
  }
  // `new Date(NaN).toISOString()` throws, and so does any date outside the
  // representable range (±8.64e15 ms). Omit the element instead of failing the
  // whole copy, consistent with optional elements being omitted when absent.
  const timestamp = new Date(line.timestamp);
  if (Number.isFinite(line.timestamp) && !Number.isNaN(timestamp.getTime())) {
    lines.push(...renderElement('  ', 'timestamp', timestamp.toISOString()));
  }
  lines.push(...renderElement('  ', 'level', line.level));
  lines.push(...renderElement('  ', 'source', line.source));
  lines.push(...renderElement('  ', 'stream', line.stream));
  if (chatroomName !== undefined || chatroomId !== undefined) {
    const nameAttribute =
      chatroomName !== undefined ? ` name="${escapeXmlAttribute(chatroomName)}"` : '';
    const content = chatroomId !== undefined ? escapeXmlText(chatroomId) : '';
    lines.push(`  <chatroom${nameAttribute}>${content}</chatroom>`);
  }
  lines.push(...renderElement('  ', 'role', getLogRole(line)));
  lines.push(...renderElement('  ', 'harness', getLogHarness(line)));
  lines.push(...renderElement('  ', 'message', line.message));

  const metadataFields: string[] = [];
  if (line.metadata) {
    for (const [key, value] of Object.entries(line.metadata)) {
      if (RESERVED_METADATA_KEYS.has(key)) {
        continue;
      }
      const stringValue = metadataValueToString(value);
      if (stringValue === undefined) {
        continue;
      }
      metadataFields.push(
        `    <field name="${escapeXmlAttribute(key)}">${escapeXmlText(stringValue)}</field>`
      );
    }
  }
  if (metadataFields.length > 0) {
    lines.push('  <metadata>', ...metadataFields, '  </metadata>');
  }

  lines.push('</logLine>');
  return `${lines.join('\n')}\n`;
}
