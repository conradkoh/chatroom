'use client';

import React, { memo, useMemo } from 'react';
import Markdown from 'react-markdown';

import { SeverityChip } from './SeverityChip';
import { chatroomRemarkPlugins } from '../chatroomRemarkPlugins';
import { fullMarkdownComponents, messageFeedProseClassNames } from '../markdown-utils';
import type { HandoffSeverity } from '../../utils/handoffSeverity';
import { parseSeverityBullet } from '../../utils/handoffSeverity';

interface HandoffActionMarkdownBodyProps {
  content: string;
  className?: string;
}

const SEVERITY_SECTIONS = new Set(['tech debt observed', 'unresolved decisions']);

/**
 * Custom markdown body for the `<handoff-action>` section.
 * Renders severity chips on bullet items under Tech Debt and Unresolved Decisions headings.
 */
export const HandoffActionMarkdownBody = memo(function HandoffActionMarkdownBody({
  content,
  className = messageFeedProseClassNames,
}: HandoffActionMarkdownBodyProps) {
  const components = useMemo(() => {
    let inSeveritySection = false;

    return {
      ...fullMarkdownComponents,
      h2: ({ children, ...props }: { children?: React.ReactNode; id?: string }) => {
        const text = extractTextContent(children).toLowerCase().trim();
        inSeveritySection = SEVERITY_SECTIONS.has(text);
        const H2 = fullMarkdownComponents.h2 as React.ComponentType<{ children?: React.ReactNode }>;
        return <H2 {...props}>{children}</H2>;
      },
      li: ({ children, ...props }: { children?: React.ReactNode }) => {
        if (!inSeveritySection) {
          const Li = fullMarkdownComponents.li as React.ComponentType<{
            children?: React.ReactNode;
          }>;
          return <Li {...props}>{children}</Li>;
        }

        const text = extractTextContent(children);
        const { severity, text: cleanText } = parseSeverityBullet(text);

        if (!severity) {
          const Li = fullMarkdownComponents.li as React.ComponentType<{
            children?: React.ReactNode;
          }>;
          return <Li {...props}>{children}</Li>;
        }

        // Render chip + cleaned text
        return (
          <li className="my-1">
            <SeverityChip severity={severity} />
            <span>{cleanText}</span>
          </li>
        );
      },
    };
  }, []);

  return (
    <div className={className}>
      <Markdown remarkPlugins={chatroomRemarkPlugins} components={components}>
        {content}
      </Markdown>
    </div>
  );
});

function extractTextContent(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractTextContent).join('');
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return extractTextContent(props.children);
  }
  return '';
}
