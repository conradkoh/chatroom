import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { BacklogCreateModal } from './BacklogCreateModal';

vi.mock('./chatroom-markdown-editor', () => ({
  ChatroomMarkdownEditorShell: ({ defaultMarkdown = '', onChange, onModEnter, modEnterDisabled }: { defaultMarkdown?: string; onChange?: (value: string) => void; onModEnter?: () => void; modEnterDisabled?: boolean }) => (
    <textarea data-testid="backlog-markdown-editor" value={defaultMarkdown} onChange={(e) => onChange?.(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !modEnterDisabled) onModEnter?.(); }} />
  ),
}));

vi.mock('@/components/ui/fixed-modal', () => ({
  FixedModal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => isOpen ? <div>{children}</div> : null,
  FixedModalContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FixedModalHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FixedModalTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FixedModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('BacklogCreateModal', () => {
  it('resets editor on close-reopen and submits on Meta+Enter', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<BacklogCreateModal isOpen onClose={vi.fn()} onSubmit={onSubmit} />);
    const editor = screen.getByTestId('backlog-markdown-editor');
    fireEvent.change(editor, { target: { value: 'draft' } });
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith('draft');
    rerender(<BacklogCreateModal isOpen={false} onClose={vi.fn()} onSubmit={onSubmit} />);
    rerender(<BacklogCreateModal isOpen onClose={vi.fn()} onSubmit={onSubmit} />);
    expect(screen.getByTestId('backlog-markdown-editor')).toHaveValue('');
  });

  it('does not submit on Meta+Enter when content is empty', () => {
    const onSubmit = vi.fn();
    render(<BacklogCreateModal isOpen onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByTestId('backlog-markdown-editor'), { key: 'Enter', metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
