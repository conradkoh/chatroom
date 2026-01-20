/**
 * Task Delivery Prompt Module
 *
 * This module handles generating the complete prompt shown to agents
 * when they receive a task via wait-for-task.
 */

import { singleSeparator } from './formatters';
import { ALL_SECTIONS, buildJsonOutput } from './sections';
import type { TaskDeliveryContext, TaskDeliveryPromptResponse, PromptSection } from './types';

export * from './types';
export * from './formatters';
export { ALL_SECTIONS, buildJsonOutput } from './sections';

/**
 * Formats a section with its header (single-line separators).
 * The first section (MESSAGE RECEIVED) uses a different format and is handled separately.
 */
function formatSectionWithHeader(section: PromptSection, ctx: TaskDeliveryContext): string {
  if (!section.shouldRender(ctx)) {
    return '';
  }

  const content = section.render(ctx);

  // MESSAGE RECEIVED section already includes its own header formatting
  if (section.id === 'message-received') {
    return content;
  }

  const header = `${singleSeparator()}\n${section.icon} ${section.title}\n${singleSeparator()}`;
  return `${header}\n${content}`;
}

/**
 * Builds the complete task delivery prompt from the given context.
 *
 * @param ctx The task delivery context containing all data
 * @returns TaskDeliveryPromptResponse with humanReadable and json
 */
export function buildTaskDeliveryPrompt(ctx: TaskDeliveryContext): TaskDeliveryPromptResponse {
  // Build human-readable sections
  const humanReadableSections = ALL_SECTIONS.map((section) =>
    formatSectionWithHeader(section, ctx)
  ).filter((content) => content.length > 0);

  const humanReadable = humanReadableSections.join('\n\n');

  // Build JSON output
  const json = buildJsonOutput(ctx);

  return {
    humanReadable,
    json,
  };
}
