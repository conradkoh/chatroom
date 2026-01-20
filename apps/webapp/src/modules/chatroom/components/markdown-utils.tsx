import React from 'react';

/**
 * Simplified markdown components for compact display.
 * Renders h1-h6 as bold inline text, strips most formatting.
 * Use with react-markdown's `components` prop.
 */
export const compactMarkdownComponents = {
  // Headers: render as bold inline text (no size change)
  h1: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h5: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  h6: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  // Paragraphs: render inline
  p: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  // Lists: render inline
  ul: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  ol: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  li: ({ children }: { children?: React.ReactNode }) => <span>• {children} </span>,
  // Code: simple styling
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="bg-chatroom-bg-tertiary px-0.5 text-[10px]">{children}</code>
  ),
  // Pre: render inline
  pre: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  // Keep emphasis
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold">{children}</strong>
  ),
  // Links: simple text with underline
  a: ({ children }: { children?: React.ReactNode }) => (
    <span className="underline">{children}</span>
  ),
};
