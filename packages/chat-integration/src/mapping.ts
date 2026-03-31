/**
 * Message mapping utilities — convert between platform message formats
 * and chatroom plain text.
 */

import type { Message as ChatMessage } from 'chat';
import type { PlatformMessage } from './types.js';

// ─── Platform → PlatformMessage ───────────────────────────────────────────────

/**
 * Convert a Chat SDK Message into our normalised PlatformMessage shape.
 *
 * This is a pure function with no side-effects — easy to test.
 */
export function toPlatformMessage(
  threadId: string,
  message: ChatMessage,
  platform: string,
): PlatformMessage {
  return {
    id: message.id,
    text: stripMarkdown(message.text ?? ''),
    threadId,
    author: {
      id: message.author?.userId ?? 'unknown',
      name: message.author?.fullName ?? message.author?.userName ?? 'unknown',
    },
    timestamp: message.metadata?.dateSent?.toISOString() ?? new Date().toISOString(),
    platform,
  };
}

// ─── Markdown Stripping ───────────────────────────────────────────────────────

/**
 * Strip common Telegram/markdown formatting to produce plain text
 * suitable for the chatroom.
 *
 * Handles:
 * - Bold: **text** / __text__
 * - Italic: *text* / _text_
 * - Strikethrough: ~~text~~
 * - Inline code: `code`
 * - Code blocks: ```code```
 * - Links: [text](url) → text
 */
export function stripMarkdown(text: string): string {
  return (
    text
      // Code blocks (``` ... ```)
      .replace(/```[\s\S]*?```/g, (match) => match.slice(3, -3).trim())
      // Inline code
      .replace(/`([^`]+)`/g, '$1')
      // Links [text](url)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Bold **text** or __text__
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      // Strikethrough ~~text~~
      .replace(/~~(.+?)~~/g, '$1')
      // Italic *text* or _text_ (must come after bold)
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/_(.+?)_/g, '$1')
  );
}

// ─── Chatroom Text → Outbound ─────────────────────────────────────────────────

/**
 * Prepare chatroom text for sending to an external platform.
 *
 * For now this is a passthrough — the Chat SDK handles formatting
 * via its own adapter. This function exists as an extension point
 * for future transformations (e.g. mention rewriting, link unfurling).
 */
export function prepareChatroomText(text: string): string {
  return text;
}
