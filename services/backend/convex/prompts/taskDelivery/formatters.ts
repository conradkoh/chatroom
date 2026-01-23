/**
 * Formatting utilities for task delivery prompt sections.
 */

import type { PromptSection, TaskDeliveryContext } from './types';

/**
 * Standard separator line width
 */
const SEPARATOR_WIDTH = 50;

/**
 * Creates a double-line separator (═)
 */
export function doubleSeparator(): string {
  return '═'.repeat(SEPARATOR_WIDTH);
}

/**
 * Creates a single-line separator (─)
 */
export function singleSeparator(): string {
  return '─'.repeat(SEPARATOR_WIDTH);
}

/**
 * Formats a section with its header and content.
 *
 * @param section The section to format
 * @param ctx The context for rendering
 * @returns Formatted section string, or empty string if section should not render
 */
export function formatSection(section: PromptSection, ctx: TaskDeliveryContext): string {
  if (!section.shouldRender(ctx)) {
    return '';
  }

  const content = section.render(ctx);
  const header = `${singleSeparator()}\n${section.icon} ${section.title}\n${singleSeparator()}`;

  return `${header}\n${content}`;
}

/**
 * Formats a major section with double-line separators.
 * Used for the primary sections like MESSAGE RECEIVED.
 */
export function formatMajorSection(icon: string, title: string, content: string): string {
  return `${doubleSeparator()}\n${icon} ${title}\n${doubleSeparator()}\n${content}`;
}

/**
 * Composes multiple sections into a single prompt string.
 *
 * @param sections Array of sections to compose
 * @param ctx The context for rendering
 * @returns Combined prompt string
 */
export function composeSections(sections: PromptSection[], ctx: TaskDeliveryContext): string {
  return sections
    .map((section) => formatSection(section, ctx))
    .filter((content) => content.length > 0)
    .join('\n\n');
}

/**
 * Formats a reminder block with warning styling.
 */
export function formatReminder(chatroomId: string, role: string): string {
  return [
    singleSeparator(),
    `⚠️  ALWAYS run \`wait-for-task\` after handoff. If it times out, run it again immediately.`,
    `    chatroom wait-for-task ${chatroomId} --role=${role}`,
    singleSeparator(),
  ].join('\n');
}
