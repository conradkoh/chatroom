import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AttachmentMarkdownModal } from './AttachmentMarkdownModal';
import { backlogProseClassNames } from '../../components/markdown-utils';

vi.mock('next/dynamic', () => ({
  default: () => {
    const MockEditor = (props: Record<string, unknown>) => {
      const { value, onChange, initialClickCoords, ...rest } = props as {
        value: string;
        onChange: (md: string) => void;
        initialClickCoords?: { left: number; top: number } | null;
      };
      return (
        <textarea
          data-testid="attachment-rich-text-editor"
          data-initial-click-coords={
            initialClickCoords ? `${initialClickCoords.left},${initialClickCoords.top}` : ''
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
      );
    };
    MockEditor.displayName = 'MockRichTextEditor';
    return MockEditor;
  },
}));

vi.mock('@/components/ui/fixed-modal', () => ({
  FixedModal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
  FixedModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const LONG_PATH =
  'apps/webapp/src/modules/chatroom/workspace/components/some/very/deep/nested/path/ThatIsWayTooLongForOneLineWithoutWrapping.ts';

describe('AttachmentMarkdownModal', () => {
  it('wraps long file paths instead of forcing horizontal scroll container', () => {
    const { container } = render(
      <AttachmentMarkdownModal
        isOpen
        onClose={() => {}}
        title="Attached Task"
        content={`\`${LONG_PATH}\``}
        proseClassName={backlogProseClassNames}
      />
    );
    expect(screen.getByText(LONG_PATH)).toBeInTheDocument();
    const proseRoot = container.querySelector('.overflow-x-hidden');
    expect(proseRoot).toBeTruthy();
    expect(proseRoot?.className).toMatch(/break-words/);
  });

  it('clicking content enters edit mode when editable', () => {
    render(
      <AttachmentMarkdownModal
        isOpen
        editable
        onSave={vi.fn()}
        onClose={() => {}}
        title="Backlog Item"
        content="Edit me"
        proseClassName={backlogProseClassNames}
      />
    );

    fireEvent.click(screen.getByText('Edit me'));

    expect(screen.getByTestId('attachment-rich-text-editor')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('clicking a link does not enter edit mode when content has [label](url)', () => {
    render(
      <AttachmentMarkdownModal
        isOpen
        editable
        onSave={vi.fn()}
        onClose={() => {}}
        title="Backlog Item"
        content="See [docs](https://example.com) for details"
        proseClassName={backlogProseClassNames}
      />
    );

    fireEvent.click(screen.getByRole('link', { name: 'docs' }));

    expect(screen.queryByTestId('attachment-rich-text-editor')).not.toBeInTheDocument();
  });

  it('content with lone [ bracket is clickable for edit', () => {
    render(
      <AttachmentMarkdownModal
        isOpen
        editable
        onSave={vi.fn()}
        onClose={() => {}}
        title="Backlog Item"
        content="Prefix [ suffix"
        proseClassName={backlogProseClassNames}
      />
    );

    fireEvent.click(screen.getByText('Prefix [ suffix'));

    expect(screen.getByTestId('attachment-rich-text-editor')).toBeInTheDocument();
  });

  it('read-only modal does not show Save button', () => {
    render(
      <AttachmentMarkdownModal
        isOpen
        onClose={() => {}}
        title="Backlog Item"
        content="Read only"
        proseClassName={backlogProseClassNames}
      />
    );

    expect(screen.queryByText('Save')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });
});
