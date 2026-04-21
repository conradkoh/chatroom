import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (must be before imports that use them) ─────────────────────────────

// Mock ContentEditableInput as a simple textarea for testing purposes.
// This keeps SendForm tests focused on business logic rather than contenteditable quirks.
vi.mock('./ContentEditableInput', () => {
  const ReactMock = require('react');

  const ContentEditableInput = ReactMock.forwardRef(function MockContentEditableInput(
    {
      value,
      onChange,
      onKeyDown,
      placeholder,
      disabled,
    }: {
      value: string;
      onChange: (value: string) => void;
      onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
      placeholder?: string;
      disabled?: boolean;
    },
    ref: React.Ref<unknown>
  ) {
    const inputRef = ReactMock.useRef(null) as React.RefObject<HTMLTextAreaElement>;

    ReactMock.useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      getCursorOffset: () => inputRef.current?.selectionStart ?? 0,
      getCaretPixelPosition: () => ({ top: 10, left: 10, height: 20 }),
      setCursorOffset: (offset: number) => {
        if (inputRef.current) {
          inputRef.current.selectionStart = offset;
          inputRef.current.selectionEnd = offset;
        }
      },
    }));

    return ReactMock.createElement('textarea', {
      ref: inputRef,
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
      onKeyDown,
      placeholder,
      disabled,
    });
  });

  return { ContentEditableInput };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

import { SendForm } from './SendForm';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock useSessionMutation
const mockSendMessage = vi.fn();
vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockSendMessage,
  useSessionQuery: () => undefined,
}));

// Mock the Convex API
vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    messages: {
      send: 'messages:send',
    },
  },
}));

// (no toast mock — SendForm uses an inline error banner instead of toasts)

// Attachment mock state (mutable so tests can control it)
const mockAttachments = {
  remove: vi.fn(),
  clearAll: vi.fn(),
  tasks: [] as { id: string; content: string }[],
  backlogItems: [] as { id: string; content: string }[],
  messages: [] as { id: string; content: string; senderRole: string }[],
};

vi.mock('../context/AttachmentsContext', () => ({
  useAttachments: () => ({
    remove: mockAttachments.remove,
    clearAll: mockAttachments.clearAll,
  }),
  useTaskAttachments: () => mockAttachments.tasks,
  useBacklogAttachments: () => mockAttachments.backlogItems,
  useMessageAttachments: () => mockAttachments.messages,
}));

// Mock AttachedTaskChip as a simple div with test-id
vi.mock('./AttachedTaskChip', () => ({
  AttachedTaskChip: ({ taskId, content }: { taskId: string; content: string }) => (
    <div data-testid={`task-chip-${taskId}`}>{content}</div>
  ),
}));

// Mock AttachedBacklogItemChip as a simple div with test-id
vi.mock('./AttachedBacklogItemChip', () => ({
  AttachedBacklogItemChip: ({ itemId, content }: { itemId: string; content: string }) => (
    <div data-testid={`backlog-chip-${itemId}`}>{content}</div>
  ),
}));

// Mock AttachedMessageChip as a simple div with test-id
vi.mock('./AttachedMessageChip', () => ({
  AttachedMessageChip: ({ messageId, content }: { messageId: string; content: string }) => (
    <div data-testid={`message-chip-${messageId}`}>{content}</div>
  ),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const CHATROOM_ID = 'room1';
const DRAFT_KEY = `chatroom-draft:${CHATROOM_ID}`;

function renderSendForm(chatroomId = CHATROOM_ID) {
  return render(<SendForm chatroomId={chatroomId} />);
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('SendForm', () => {
  beforeEach(() => {
    // Reset mocks
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue(undefined);
    mockAttachments.remove.mockReset();
    mockAttachments.clearAll.mockReset();
    mockAttachments.tasks = [];
    mockAttachments.backlogItems = [];
    mockAttachments.messages = [];

    // Clear localStorage
    localStorage.clear();

    // Default: non-touch device (pointer: fine)
    // Mock matchMedia to return false for (pointer: coarse)
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Draft Persistence ───────────────────────────────────────────────────────

  describe('Draft Persistence', () => {
    it('restores draft from localStorage on mount', async () => {
      // Set draft in localStorage before render
      const draft = JSON.stringify({ content: 'My saved draft', updatedAt: Date.now() });
      localStorage.setItem(DRAFT_KEY, draft);

      renderSendForm();

      // Wait for the useEffect to restore the draft
      await waitFor(() => {
        const textarea = screen.getByPlaceholderText('Type a message...');
        expect(textarea).toHaveValue('My saved draft');
      });
    });

    it('clears draft from localStorage after successful send', async () => {
      const user = userEvent.setup();
      renderSendForm();

      const textarea = screen.getByPlaceholderText('Type a message...');
      await user.type(textarea, 'Hello world');

      // Set the draft key in localStorage to simulate it being there
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ content: 'Hello world', updatedAt: Date.now() })
      );

      const sendButton = screen.getByRole('button', { name: /send/i });
      await user.click(sendButton);

      await waitFor(() => {
        expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
      });
    });

    it('saves draft to localStorage after typing (500ms debounce)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      renderSendForm();

      const textarea = screen.getByPlaceholderText('Type a message...');

      // Fire a change event to simulate typing
      act(() => {
        fireEvent.change(textarea, { target: { value: 'Draft text' } });
      });

      // Before debounce fires — draft should not be saved yet
      expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

      // Advance timers past the 500ms debounce
      act(() => {
        vi.advanceTimersByTime(600);
      });

      const raw = localStorage.getItem(DRAFT_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.content).toBe('Draft text');
    });
  });

  // ── Message Submission ──────────────────────────────────────────────────────

  describe('Message Submission', () => {
    it('sends message on form submit', async () => {
      const user = userEvent.setup();
      renderSendForm();

      const textarea = screen.getByPlaceholderText('Type a message...');
      await user.type(textarea, 'Hello world');

      const sendButton = screen.getByRole('button', { name: /send/i });
      await user.click(sendButton);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            chatroomId: CHATROOM_ID,
            content: 'Hello world',
            senderRole: 'user',
            type: 'message',
          })
        );
      });
    });

    it('does not send empty/whitespace-only messages — Send button is disabled', async () => {
      renderSendForm();

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toBeDisabled();
    });

    it('does not send whitespace-only messages — Send button is disabled', async () => {
      const user = userEvent.setup();
      renderSendForm();

      const textarea = screen.getByPlaceholderText('Type a message...');
      await user.type(textarea, '   ');

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toBeDisabled();
    });

    it('clears attachments after successful send', async () => {
      mockAttachments.tasks = [{ id: 'task-1', content: 'Task one' }];
      mockAttachments.backlogItems = [{ id: 'backlog-1', content: 'Backlog one' }];

      const user = userEvent.setup();
      renderSendForm();

      const textarea = screen.getByPlaceholderText('Type a message...');
      await user.type(textarea, 'Message with attachments');

      const sendButton = screen.getByRole('button', { name: /send/i });
      await user.click(sendButton);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        expect(mockAttachments.clearAll).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ── Send Failure Resilience ────────────────────────────────────────────────────

  describe('Send Failure Resilience', () => {
    it('Send button is re-enabled after a failed send', async () => {
      // Simulate a network/server error during send
      mockSendMessage.mockRejectedValueOnce(new Error('Network error'));

      const user = userEvent.setup();
      renderSendForm();

      const textarea = screen.getByPlaceholderText('Type a message...');
      await user.type(textarea, 'Hello');

      const sendButton = screen.getByRole('button', { name: /send/i });

      // Button should be enabled before send
      expect(sendButton).not.toBeDisabled();

      await user.click(sendButton);

      // After the failed send resolves, the button must be clickable again
      await waitFor(() => {
        expect(sendButton).not.toBeDisabled();
      });
    });

    it('shows an inline error banner after a failed send', async () => {
      mockSendMessage.mockRejectedValueOnce(new Error('Server error'));

      const user = userEvent.setup();
      renderSendForm();

      const textarea = screen.getByPlaceholderText('Type a message...');
      await user.type(textarea, 'Hello');

      await user.click(screen.getByRole('button', { name: /send/i }));

      // Inline error banner appears (role="alert") with the failure message,
      // and is dismissible via the close button — no toast is shown.
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/Failed to send/i);
      expect(alert).toHaveTextContent(/Server error/i);
      expect(
        screen.getByRole('button', { name: /Dismiss send error/i })
      ).toBeInTheDocument();
    });

    it('clears the inline error when the user starts typing again', async () => {
      mockSendMessage.mockRejectedValueOnce(new Error('Server error'));

      const user = userEvent.setup();
      renderSendForm();

      const textarea = screen.getByPlaceholderText('Type a message...');
      await user.type(textarea, 'Hello');
      await user.click(screen.getByRole('button', { name: /send/i }));

      await screen.findByRole('alert');

      // Typing one more character should clear the banner.
      await user.type(textarea, '!');

      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    });

    it('preserves the message text after a failed send (allows retry)', async () => {
      mockSendMessage.mockRejectedValueOnce(new Error('Timeout'));

      const user = userEvent.setup();
      renderSendForm();

      const textarea = screen.getByPlaceholderText('Type a message...');
      await user.type(textarea, 'Retry this message');

      await user.click(screen.getByRole('button', { name: /send/i }));

      // Message text should still be in the input (not cleared on failure)
      await waitFor(() => {
        expect(textarea).toHaveValue('Retry this message');
      });
    });
  });

  // ── Attachment Rendering ────────────────────────────────────────────────────

  describe('Attachment Rendering', () => {
    it('renders AttachedTaskChip for each attached task', () => {
      mockAttachments.tasks = [
        { id: 'task-1', content: 'Task one' },
        { id: 'task-2', content: 'Task two' },
      ];

      renderSendForm();

      expect(screen.getByTestId('task-chip-task-1')).toBeInTheDocument();
      expect(screen.getByTestId('task-chip-task-2')).toBeInTheDocument();
    });

    it('renders AttachedBacklogItemChip for each attached backlog item', () => {
      mockAttachments.backlogItems = [
        { id: 'backlog-1', content: 'Backlog one' },
        { id: 'backlog-2', content: 'Backlog two' },
      ];

      renderSendForm();

      expect(screen.getByTestId('backlog-chip-backlog-1')).toBeInTheDocument();
      expect(screen.getByTestId('backlog-chip-backlog-2')).toBeInTheDocument();
    });

    it('attachment row is hidden when no attachments', () => {
      mockAttachments.tasks = [];
      mockAttachments.backlogItems = [];

      renderSendForm();

      // There should be no task or backlog chips rendered
      expect(screen.queryByTestId(/task-chip-/)).not.toBeInTheDocument();
      expect(screen.queryByTestId(/backlog-chip-/)).not.toBeInTheDocument();
    });
  });

  // ── Keyboard Behavior ───────────────────────────────────────────────────────

  describe('Keyboard Behavior', () => {
    it('Enter submits on desktop (non-touch device)', async () => {
      // Ensure non-touch device (default matchMedia returns false for pointer: coarse)

      const user = userEvent.setup();
      renderSendForm();

      // Wait for the useIsTouchDevice effect to run
      await act(async () => {});

      const textarea = screen.getByPlaceholderText('Type a message...');
      await user.type(textarea, 'Desktop message');

      // Press Enter (no shift)
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            content: 'Desktop message',
          })
        );
      });
    });

    it('Shift+Enter does NOT submit on desktop', async () => {
      // Default: non-touch device (matchMedia returns false for pointer: coarse)

      const user = userEvent.setup();
      renderSendForm();

      await act(async () => {});

      const textarea = screen.getByPlaceholderText('Type a message...');
      await user.type(textarea, 'Some text');

      // Press Shift+Enter — should insert newline, not submit
      await user.keyboard('{Shift>}{Enter}{/Shift}');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('Enter does NOT submit on touch device', async () => {
      // Simulate touch device: matchMedia returns true for (pointer: coarse)
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(pointer: coarse)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const user = userEvent.setup();
      renderSendForm();

      // Wait for the useIsTouchDevice effect to detect touch
      await act(async () => {});

      const textarea = screen.getByPlaceholderText('Type a message...');
      await user.type(textarea, 'Touch message');

      // Clear previous sendMessage calls from typing (just in case)
      mockSendMessage.mockClear();

      // Press Enter — on touch device should NOT submit
      await user.keyboard('{Enter}');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });
});
