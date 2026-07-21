import { render, screen } from '@testing-library/react';
import Markdown from 'react-markdown';
import { describe, expect, it } from 'vitest';

import { fullMarkdownComponents } from './markdown-utils';
import { WorkspaceFileLinkProvider } from '../context/WorkspaceFileLinkContext';
import { MarkdownRenderer } from '../workspace/file-renderers/MarkdownRenderer';

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
