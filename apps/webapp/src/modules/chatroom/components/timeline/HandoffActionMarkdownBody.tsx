'use client';

import { memo } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';

import { chatroomRemarkPlugins } from '../chatroomRemarkPlugins';
import { messageFeedProseClassNames } from '../markdown-utils';
import {
  parseSeverityBullet,
  getSeverityChipClassName,
  getSeverityLabel,
} from '../../utils/handoffSeverity';

interface HandoffActionMarkdownBodyProps {
  content: string;
  className?: string;
}

/**
 * Pre-processes markdown content to replace severity-prefixed list items
 * under ## Tech Debt Observed and ## Unresolved Decisions sections
 * with inline HTML containing severity chip markup.
 */
function preprocessActionMarkdown(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inSeveritySection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^##\s+/i.test(trimmed)) {
      const headingText = trimmed
        .replace(/^##\s+/i, '')
        .toLowerCase()
        .trim();
      inSeveritySection =
        headingText === 'tech debt observed' || headingText === 'unresolved decisions';
      result.push(line);
      continue;
    }

    if (inSeveritySection && /^\s*[-*]\s+/.test(line)) {
      const { severity, text: cleanText } = parseSeverityBullet(line);
      if (severity) {
        const chipClass = getSeverityChipClassName(severity);
        const label = getSeverityLabel(severity);
        const chipHtml = `<span data-testid="severity-chip-${severity}" class="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border rounded-sm mr-1.5 align-middle ${chipClass}">${label}</span>`;
        result.push(`- ${chipHtml}${cleanText}`);
        continue;
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Custom markdown body for the `<handoff-action>` section.
 * Renders severity chips via pre-processing before markdown render.
 */
export const HandoffActionMarkdownBody = memo(function HandoffActionMarkdownBody({
  content,
  className = messageFeedProseClassNames,
}: HandoffActionMarkdownBodyProps) {
  const processed = preprocessActionMarkdown(content);

  return (
    <div className={className}>
      <Markdown remarkPlugins={chatroomRemarkPlugins} rehypePlugins={[rehypeRaw]}>
        {processed}
      </Markdown>
    </div>
  );
});
