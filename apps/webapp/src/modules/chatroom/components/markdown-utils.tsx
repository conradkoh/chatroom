'use client';

import { Check, Copy } from 'lucide-react';
import React, { useState, useCallback } from 'react';

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

/**
 * Extract text content from React children (handles nested code elements)
 */
function extractTextContent(children: React.ReactNode): string {
  if (typeof children === 'string') {
    return children;
  }
  if (Array.isArray(children)) {
    return children.map(extractTextContent).join('');
  }
  if (React.isValidElement(children)) {
    // Handle code element inside pre
    const props = children.props as { children?: React.ReactNode };
    return extractTextContent(props.children);
  }
  return '';
}

/**
 * CodeBlock component with copy button for fenced code blocks.
 * Shows language badge and copy functionality.
 */
export function CodeBlock({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  // Extract language from className (e.g., "language-typescript" -> "typescript")
  const language = className?.replace('language-', '') || '';

  // Extract text content for copying
  const textContent = extractTextContent(children);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [textContent]);

  return (
    <div className="relative group not-prose mb-3">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-chatroom-bg-secondary border-2 border-b-0 border-chatroom-border px-4 py-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-text-primary transition-opacity opacity-80 hover:opacity-100"
          title={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? (
            <>
              <Check size={12} className="text-chatroom-status-success" />
              <span className="text-chatroom-status-success font-mono">COPIED</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>COPY</span>
            </>
          )}
        </button>
      </div>
      {/* Code content */}
      <pre className="bg-chatroom-bg-secondary border-2 border-chatroom-border p-4 overflow-x-auto">
        <code className={`${className || ''} text-xs text-chatroom-text-primary font-mono`}>
          {children}
        </code>
      </pre>
    </div>
  );
}

/**
 * Full markdown components with enhanced code block rendering.
 * Includes copy button for fenced code blocks.
 * Use with react-markdown's `components` prop.
 */
export const fullMarkdownComponents = {
  // Wrap pre elements with CodeBlock for copy functionality
  pre: ({ children }: { children?: React.ReactNode }) => {
    // The children of pre is usually a code element
    if (React.isValidElement(children)) {
      const codeProps = children.props as { children?: React.ReactNode; className?: string };
      return <CodeBlock className={codeProps.className}>{codeProps.children}</CodeBlock>;
    }
    // Fallback for non-code pre content
    return (
      <pre className="bg-chatroom-bg-tertiary border-2 border-chatroom-border p-3 my-3 overflow-x-auto text-sm text-chatroom-text-primary">
        {children}
      </pre>
    );
  },
  // Inline code (not in pre) - keep simple styling
  code: ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
    inline?: boolean;
  }) => {
    // If has language class, it's a code block (handled by pre)
    // This handles inline code only
    if (className?.startsWith('language-')) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="bg-chatroom-bg-tertiary px-1.5 py-0.5 text-chatroom-status-success text-[0.9em]">
        {children}
      </code>
    );
  },
};
