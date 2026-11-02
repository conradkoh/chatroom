import { getLogChatroomId, getLogHarness, getLogRole } from './log-line.js';
import type { LogLine } from '../api/types.js';

/** Metadata keys that already have their own dedicated element in the document. */
const RESERVED_METADATA_KEYS = new Set(['chatroomId', 'role', 'harness']);

/**
 * Escape a string so the result is safe to embed in XML character data.
 *
 * The output is guaranteed to be pure ASCII: characters outside printable
 * ASCII (0x20-0x7E), plus control characters other than `\n` and `\t`, are
 * emitted as uppercase-hex numeric character references. `\n` and `\t` are
 * preserved verbatim so multi-line messages keep their shape.
 */
function escapeXmlText(value: string): string {
  let out = '';
  // Iterating a string yields code points, so astral characters (emoji) are
  // emitted as a single reference rather than two surrogate escapes.
  for (const char of value) {
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
  for (const char of value) {
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
  lines.push(...renderElement('  ', 'timestamp', new Date(line.timestamp).toISOString()));
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
