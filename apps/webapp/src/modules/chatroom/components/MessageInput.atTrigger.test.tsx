/**
 * MessageInput — @ file trigger integration tests
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { FileEntry } from './FileSelector/useFileSelector';
import { MessageInput } from './MessageInput';
import { AttachmentsProvider } from '../attachments';

const mockSendMessage = vi.fn().mockResolvedValue('msg-id');

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockSendMessage,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    messages: {
      sendMessage: 'messages:sendMessage',
    },
  },
}));

vi.mock('./EditorModal', () => ({
  EditorModal: () => null,
}));

function renderAtTriggerInput(files: FileEntry[] = []) {
  return render(
    <AttachmentsProvider>
      <MessageInput chatroomId="chatroom-1" files={files} hasAutocompleteWorkspace />
    </AttachmentsProvider>
  );
}

describe('MessageInput @ trigger', () => {
  it('shows file results when files load after typing @ without update depth errors', async () => {
    const fileA: FileEntry = { path: 'src/a.ts', type: 'file' };
    const { rerender } = renderAtTriggerInput();

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '@', selectionStart: 1 } });

    rerender(
      <AttachmentsProvider>
        <MessageInput chatroomId="chatroom-1" files={[fileA]} hasAutocompleteWorkspace />
      </AttachmentsProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('a.ts')).toBeInTheDocument();
    });
  });

  it('navigates file results with arrow keys after @<query>', async () => {
    const files: FileEntry[] = [
      { path: 'src/a.ts', type: 'file' },
      { path: 'src/b.ts', type: 'file' },
      { path: 'src/c.ts', type: 'file' },
    ];
    renderAtTriggerInput(files);

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '@src', selectionStart: 4 } });

    await waitFor(() => {
      expect(document.querySelectorAll('[data-autocomplete-item]')).toHaveLength(3);
    });

    const getHighlightedIndex = () =>
      Array.from(document.querySelectorAll('[data-autocomplete-item]')).findIndex((el) =>
        el.className.split(/\s+/).includes('bg-chatroom-bg-hover')
      );

    expect(getHighlightedIndex()).toBe(0);

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(getHighlightedIndex()).toBe(1);

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(getHighlightedIndex()).toBe(2);

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(getHighlightedIndex()).toBe(1);
  });

  it('inserts the highlighted file on Enter after arrow navigation', async () => {
    const files: FileEntry[] = [
      { path: 'src/a.ts', type: 'file' },
      { path: 'src/b.ts', type: 'file' },
    ];
    renderAtTriggerInput(files);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@src', selectionStart: 4 } });

    await waitFor(() => {
      expect(document.querySelectorAll('[data-autocomplete-item]')).toHaveLength(2);
    });

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(textarea.value).toContain('src/b.ts');
    });
  });

  it('keeps @ active when Enter selects a folder so the user can drill into files', async () => {
    const files: FileEntry[] = [
      { path: 'very-long-folder-name', type: 'directory' },
      { path: 'very-long-folder-name/a.ts', type: 'file' },
      { path: 'very-long-folder-name/b.ts', type: 'file' },
    ];
    renderAtTriggerInput(files);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@very', selectionStart: 5 } });

    await waitFor(() => {
      expect(document.querySelectorAll('[data-autocomplete-item]')).toHaveLength(3);
    });

    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(textarea.value).toBe('@very-long-folder-name/');
    });

    await waitFor(() => {
      expect(screen.getByText('a.ts')).toBeInTheDocument();
      expect(screen.getByText('b.ts')).toBeInTheDocument();
    });
  });

  it('inserts a quoted file reference when the path contains spaces', async () => {
    const files: FileEntry[] = [{ path: 'my folder/file name.txt', type: 'file' }];
    renderAtTriggerInput(files);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@file', selectionStart: 5 } });

    await waitFor(() => {
      expect(screen.getByText('file name.txt')).toBeInTheDocument();
    });

    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(textarea.value).toContain('@"my folder/file name.txt"');
    });
  });
});
