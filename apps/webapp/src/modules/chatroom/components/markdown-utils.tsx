'use client';

import { Check, Copy, FileText } from 'lucide-react';
import React, { useState, useCallback, lazy, Suspense } from 'react';
import { decodeFileReferences } from '@/lib/fileReference';

// Lazy load MermaidBlock to avoid bundling mermaid in the main chunk
const MermaidBlock = lazy(() =>
  import('./MermaidBlock').then((m) => ({ default: m.MermaidBlock }))
);

// ============================================================================
// Prose className Constants
// ============================================================================

/**
 * Full rich content prose styling (tables, blockquotes, links).
 * Used in: MessageDetailModal, FeatureDetailModal, PromptModal.
 *
 * Features:
 * - Dark mode support
 * - Styled tables with borders
 * - Link colors (info/accent on hover)
 * - Styled blockquotes
 */
export const proseClassNames =
  'text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary';

/**
 * Backlog/task chip prose styling (uppercase headings, explicit text colors).
 * Used in: BacklogItemDetailModal, AttachedBacklogItemChip, AttachedTaskChip.
 *
 * Features:
 * - Bold uppercase headings with tracking
 * - Explicit text colors for all elements
 * - Styled code blocks with bg-tertiary
 * - No rounded corners on pre blocks
 *
 * Note: Layout classes like `p-4` should be added in the component, not here.
 */
export const backlogProseClassNames =
  'text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-bold prose-headings:uppercase prose-headings:tracking-wider prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-chatroom-text-primary prose-p:my-2 prose-p:text-chatroom-text-primary prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary prose-code:text-chatroom-text-primary prose-code:bg-chatroom-bg-tertiary prose-code:px-1 prose-li:text-chatroom-text-primary prose-pre:bg-chatroom-bg-tertiary prose-pre:border prose-pre:border-chatroom-border prose-pre:rounded-none';

/**
 * Task detail prose styling (success-colored inline code).
 * Used in: TaskDetailModal, AttachedTaskDetailModal.
 *
 * Features:
 * - Success-colored inline code
 * - Styled pre blocks with borders
 * - Link colors (info/accent on hover)
 *
 * Note: Layout classes like `h-full overflow-y-auto p-4 text-sm` should be added in the component.
 */
export const taskDetailProseClassNames =
  'prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-code:bg-chatroom-bg-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-chatroom-status-success prose-code:text-[0.9em] prose-pre:bg-chatroom-bg-tertiary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-pre:overflow-x-auto prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-ul:my-2 prose-ol:my-2 prose-li:my-0 text-chatroom-text-primary';

/**
 * Message feed prose styling (compact, table scrolling).
 * Used in: MessageFeed.
 *
 * Features:
 * - Compact 13px text
 * - Underlined links with decoration
 * - Scrollable tables
 */
export const messageFeedProseClassNames =
  'text-chatroom-text-primary text-[13px] leading-relaxed break-words overflow-x-hidden prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-a:text-chatroom-status-info prose-a:underline prose-a:decoration-chatroom-status-info/50 hover:prose-a:decoration-chatroom-status-info prose-table:border-collapse prose-table:block prose-table:overflow-x-auto prose-table:w-fit prose-table:max-w-full prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary';

/**
 * Compact prose styling for WorkQueue items and inline previews.
 * Used in: TaskItem.tsx
 *
 * Features:
 * - Extra compact (prose-xs)
 * - No margins on most elements
 * - Small code text
 *
 * Note: Layout classes like `line-clamp-3 mb-2` should be added in the component.
 */
export const compactProseClassNames =
  'text-xs text-chatroom-text-primary prose dark:prose-invert prose-xs max-w-none prose-p:my-0 prose-headings:my-0 prose-headings:text-xs prose-headings:font-bold prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-code:text-[10px] prose-code:bg-chatroom-bg-tertiary prose-code:px-1 prose-pre:bg-chatroom-bg-tertiary prose-pre:text-chatroom-text-primary prose-pre:p-2 prose-pre:my-1 prose-pre:overflow-x-auto';

/**
 * Inline event prose styling for compact event content display.
 * Used in: eventTypes/shared.tsx
 *
 * Features:
 * - Small prose-sm for inline context
 * - Minimal margins for compact display
 *
 * Note: Layout classes like `mt-1` should be added in the component.
 */
export const inlineEventProseClassNames =
  'text-[11px] text-chatroom-text-primary prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-1 prose-li:my-0 prose-ul:my-1 prose-ol:my-1';

/**
 * Context summary prose styling for "New Context" modal.
 * Used in: MessageFeed.tsx (SystemMessage component).
 *
 * Features:
 * - Compact 13px text (same size as message feed)
 * - Tighter heading spacing (mt-3 mb-1 vs mt-4 mb-2)
 * - Tighter paragraph spacing (my-1 vs my-2)
 * - Underlined links with decoration
 * - Blockquote uses bg-secondary (not bg-tertiary)
 */
export const contextSummaryProseClassNames =
  'text-chatroom-text-primary text-[13px] leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1 prose-a:text-chatroom-status-info prose-a:underline prose-a:decoration-chatroom-status-info/50 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-secondary prose-blockquote:text-chatroom-text-secondary';

// ============================================================================
// Markdown Components
// ============================================================================

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
  // Links: underlined with proper color, always open in new window
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a
      href={href}
      className="text-chatroom-status-info underline decoration-chatroom-status-info/50 hover:decoration-chatroom-status-info transition-colors"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
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
 * Shared link component that always opens in a new window/tab.
 * Used across all markdown component sets for consistent behavior.
 */
const MarkdownLink = ({ children, href }: { children?: React.ReactNode; href?: string }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

// ============================================================================
// File Reference Rendering
// ============================================================================

/**
 * Inline chip for file references in messages.
 * Rendered when a link with `fileref://` scheme is detected in markdown.
 */
const FileReferenceChip = ({ filePath }: { filePath: string }) => {
  const fileName = filePath.split('/').pop() ?? filePath;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-chatroom-bg-tertiary border border-chatroom-border text-chatroom-text-primary text-xs font-mono rounded-sm align-middle"
      title={filePath}
    >
      <FileText size={12} className="shrink-0 text-chatroom-text-muted" />
      <span className="truncate max-w-[200px]">{fileName}</span>
    </span>
  );
};

/**
 * Link component that renders file references as inline chips.
 * Regular links open in a new tab. `fileref://` links render as file chips.
 */
const FileAwareMarkdownLink = ({
  children,
  href,
}: {
  children?: React.ReactNode;
  href?: string;
}) => {
  if (href?.startsWith('fileref://')) {
    // Extract workspace/path from fileref://workspace/path
    const refContent = href.slice('fileref://'.length);
    const firstSlash = refContent.indexOf('/');
    const filePath = firstSlash !== -1 ? refContent.slice(firstSlash + 1) : refContent;
    return <FileReferenceChip filePath={filePath} />;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
};

/**
 * Pre-process message content to convert `{file://workspace/path}` tokens
 * into markdown links that the FileAwareMarkdownLink component can render as chips.
 *
 * Skips file references inside code blocks (``` ... ```) and inline code (` ... `).
 */
export function preprocessFileReferences(content: string): string {
  if (!content || !content.includes('{file://')) return content;

  // Extract code block and inline code ranges to skip
  const skipRanges: Array<{ start: number; end: number }> = [];

  // Fenced code blocks (``` ... ```)
  const fencedCodeRegex = /```[\s\S]*?```/g;
  let match: RegExpExecArray | null;
  while ((match = fencedCodeRegex.exec(content)) !== null) {
    skipRanges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Inline code (` ... `)
  const inlineCodeRegex = /`[^`]+`/g;
  while ((match = inlineCodeRegex.exec(content)) !== null) {
    skipRanges.push({ start: match.index, end: match.index + match[0].length });
  }

  const refs = decodeFileReferences(content);
  if (refs.length === 0) return content;

  // Build the result by replacing refs that are NOT inside code blocks
  let result = '';
  let lastIndex = 0;

  for (const ref of refs) {
    // Check if this ref is inside a skip range
    const isInCodeBlock = skipRanges.some(
      (range) => ref.start >= range.start && ref.end <= range.end
    );

    if (isInCodeBlock) {
      // Keep as-is
      continue;
    }

    // Add text before this reference
    result += content.slice(lastIndex, ref.start);

    // Replace with markdown link using fileref:// scheme
    const fileName = ref.filePath.split('/').pop() ?? ref.filePath;
    result += `[${fileName}](fileref://${ref.workspace}/${ref.filePath})`;

    lastIndex = ref.end;
  }

  // Add remaining text
  result += content.slice(lastIndex);

  return result;
}

/**
 * Base markdown components with just the link override.
 * Use this for Markdown instances that don't need compact or full styling
 * but still need links to open in a new window.
 */
export const baseMarkdownComponents = {
  a: MarkdownLink,
};

/**
 * Full markdown components with enhanced code block rendering.
 * Includes copy button for fenced code blocks.
 * Use with react-markdown's `components` prop.
 */
export const fullMarkdownComponents = {
  // Links: file references render as chips, regular links open in new window
  a: FileAwareMarkdownLink,
  // Wrap pre elements with CodeBlock for copy functionality, or MermaidBlock for diagrams
  pre: ({ children }: { children?: React.ReactNode }) => {
    // The children of pre is usually a code element
    if (React.isValidElement(children)) {
      const codeProps = children.props as { children?: React.ReactNode; className?: string };
      // Mermaid diagram rendering
      if (codeProps.className === 'language-mermaid') {
        const chart = extractTextContent(codeProps.children);
        return (
          <Suspense
            fallback={
              <div className="my-3 flex justify-center p-4 bg-chatroom-bg-tertiary border-2 border-chatroom-border">
                <span className="text-xs text-chatroom-text-muted">Loading diagram...</span>
              </div>
            }
          >
            <MermaidBlock chart={chart} />
          </Suspense>
        );
      }
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
