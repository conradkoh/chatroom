import { render, screen } from '@testing-library/react';
import Markdown from 'react-markdown';
import { describe, expect, it } from 'vitest';

import {
  backlogProseClassNames,
  backlogRichTextEditorProseClassNames,
  fullMarkdownComponents,
  modalMarkdownComponents,
  backlogModalMarkdownProseClassNames,
  messageFeedProseClassNames,
} from './markdown-utils';
import { chatroomRemarkPlugins } from './chatroomRemarkPlugins';
import { WorkspaceFileLinkProvider } from '../context/WorkspaceFileLinkContext';
import { MarkdownRenderer } from '../workspace/file-renderers/MarkdownRenderer';

describe('backlog prose heading case', () => {
  it('does not force uppercase on markdown headings', () => {
    expect(backlogProseClassNames).not.toContain('uppercase');
    expect(backlogProseClassNames).not.toContain('tracking-wider');
    expect(backlogRichTextEditorProseClassNames).not.toContain('uppercase');
  });
});

describe('markdown inline code selection', () => {
  it('disables typography pseudo-element backticks on prose containers', () => {
    expect(messageFeedProseClassNames).toContain('prose-code:before:content-none');
    expect(messageFeedProseClassNames).toContain('prose-code:after:content-none');
  });

  it('renders inline code without decorative before/after pseudo-elements', () => {
    render(<Markdown components={fullMarkdownComponents}>{'`chatroom context read`'}</Markdown>);

    const code = screen.getByText('chatroom context read');
    expect(code.tagName).toBe('CODE');
    expect(code.className).toContain('before:content-none');
    expect(code.className).toContain('after:content-none');
  });
});

describe('markdown workspace links', () => {
  it('does not nest workspace link buttons when link label is inline code', () => {
    render(
      <WorkspaceFileLinkProvider onOpenFile={() => {}}>
        <Markdown components={fullMarkdownComponents}>
          {'[`docs/memory.md`](../../docs/memory.md)'}
        </Markdown>
      </WorkspaceFileLinkProvider>
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button')).toHaveTextContent('docs/memory.md');
  });

  it('does not nest buttons in explorer markdown preview with relative links', () => {
    render(
      <WorkspaceFileLinkProvider onOpenFile={() => {}} baseFilePath="apps/adtech/README.md">
        <MarkdownRenderer content={'[`docs/memory.md`](../../docs/memory.md)'} />
      </WorkspaceFileLinkProvider>
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('backlog modal markdown prose SSOT', () => {
  it('does not duplicate wrap modifier blocks in surface prose classes', () => {
    const signature = 'prose-pre:overflow-x-hidden';
    const first = backlogModalMarkdownProseClassNames.indexOf(signature);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBe(backlogModalMarkdownProseClassNames.lastIndexOf(signature));
  });

  it('uses secondary background and thick borders for fenced code', () => {
    expect(backlogModalMarkdownProseClassNames).toContain('prose-pre:bg-chatroom-bg-secondary');
    expect(backlogModalMarkdownProseClassNames).toContain('prose-pre:border-2');
  });
});

describe('modal markdown spacing', () => {
  it('renders nbsp spacer paragraphs around code blocks in modal preview', () => {
    const markdown =
      'This is some content!\n\n&nbsp;\n\n```txt\nasdasd\nasdsad\n```\n\n&nbsp;\n';
    const { container } = render(
      <Markdown remarkPlugins={chatroomRemarkPlugins} components={modalMarkdownComponents}>
        {markdown}
      </Markdown>
    );

    expect(container.querySelectorAll('p.min-h-\\[1\\.5em\\][aria-hidden="true"]')).toHaveLength(2);
    expect(screen.getByText('This is some content!')).toBeInTheDocument();
  });
});
