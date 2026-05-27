import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contract test for the service worker file.
 *
 * Verifies that sw.js follows the Path 1 approach:
 * - No client.navigate calls (soft navigation via postMessage only)
 * - Has a postMessage-based NAVIGATE_TO_CHATROOM contract
 * - Does not include ?view= in notification click URLs
 */
describe('SW handler contract', () => {
  const swPath = resolve(__dirname, '../../../../public/sw.js');
  const swContent = readFileSync(swPath, 'utf-8');

  it('does not use client.navigate in notificationclick handler', () => {
    // The notificationclick handler should use postMessage, not client.navigate
    const notificationClickSection = extractNotificationClickSection(swContent);
    expect(notificationClickSection).not.toContain('client.navigate');
  });

  it('includes postMessage call in notificationclick handler', () => {
    const notificationClickSection = extractNotificationClickSection(swContent);
    expect(notificationClickSection).toContain('postMessage');
  });

  it('does not include ?view= in notificationclick URL construction', () => {
    const notificationClickSection = extractNotificationClickSection(swContent);
    expect(notificationClickSection).not.toContain('?view=');
  });

  it('posts NAVIGATE_TO_CHATROOM message with chatroomId', () => {
    const notificationClickSection = extractNotificationClickSection(swContent);
    expect(notificationClickSection).toContain('NAVIGATE_TO_CHATROOM');
    expect(notificationClickSection).toContain('chatroomId');
  });

  it('openWindow URL does not include ?view= parameter', () => {
    // When no matching tab, the SW should openWindow without ?view=
    const urlMatch = swContent.match(/openWindow\(([^)]+)\)/);
    if (urlMatch) {
      expect(urlMatch[1]).not.toContain('view=');
    }
  });

  it('SHOW_NOTIFICATION payload does not include view field', () => {
    // The SHOW_NOTIFICATION case should not have a `view` field
    const showNotificationMatch = swContent.match(/case 'SHOW_NOTIFICATION':\s*\{([\s\S]+?)\}/);
    if (showNotificationMatch) {
      expect(showNotificationMatch[1]).not.toContain('view');
    }
  });
});

function extractNotificationClickSection(code: string): string {
  const startMarker = "self.addEventListener('notificationclick'";
  const startIdx = code.indexOf(startMarker);
  if (startIdx === -1) return '';

  // Find the matching closing paren/bracket by counting braces
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let endIdx = startIdx;

  for (let i = startIdx; i < code.length; i++) {
    const ch = code[i];
    if (inString) {
      if (ch === '\\') {
        i++; // skip escaped char
        continue;
      }
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '{' || ch === '(') depth++;
    if (ch === '}' || ch === ')') {
      depth--;
      if (depth <= 0) {
        endIdx = i + 1;
        break;
      }
    }
  }

  return code.slice(startIdx, endIdx);
}
