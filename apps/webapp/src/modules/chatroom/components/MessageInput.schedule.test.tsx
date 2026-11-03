/**
 * MessageInput — send-button schedule gestures (right-click / long-press).
 *
 * Gestures open a one-item "Schedule message" menu; choosing the item is what
 * requests the schedule. The request is observed through the real composer
 * store (`getPendingScheduledPrompt`), so only the Convex mutation boundary is
 * substituted. Touch behaviour is simulated with pointer events and fake
 * timers; real-device gestures are out of scope here.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachmentsProvider, useAttachments } from '../attachments';
import { MessageInput } from './MessageInput';
import {
  clearPendingScheduledPrompt,
  getPendingScheduledPrompt,
} from '../features/scheduled-prompts/stores/scheduledPromptComposerStore';

const mockSendMessage = vi.fn().mockResolvedValue('msg-id');
let uploadJobs: {
  id: string;
  phase: string;
  percent: number;
  filePath: string;
  fileName: string;
}[] = [];

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

vi.mock('../hooks/useChatInputFileDrop', () => ({
  useChatInputFileDrop: (args: { message: string; setMessage: (value: string) => void }) => ({
    uploadJobs,
    isDragging: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    fileInputRef: { current: null },
    handleAttachClick: vi.fn(),
    handleFileInputChange: vi.fn(),
    handlePaste: vi.fn(),
    attachFiles: vi.fn(),
    setMessage: args.setMessage,
  }),
}));

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

  // jsdom has no PointerEvent; testing-library then drops pointer init fields.
  if (typeof window.PointerEvent === 'undefined') {
    class MockPointerEvent extends MouseEvent {
      public pointerType: string;

      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerType = params.pointerType ?? 'mouse';
      }
    }
    (window as unknown as { PointerEvent: unknown }).PointerEvent = MockPointerEvent;
  }
});

function TaskAttachmentSeed() {
  const { add, isAttached } = useAttachments();
  React.useEffect(() => {
    if (!isAttached('task', 'task-1')) {
      add({
        type: 'task',
        id: 'task-1' as Id<'chatroom_tasks'>,
        content: 'Attached task',
      });
    }
  }, [add, isAttached]);
  return null;
}

function renderComposer({ withAttachment = false } = {}) {
  return render(
    <AttachmentsProvider>
      {withAttachment && <TaskAttachmentSeed />}
      <MessageInput chatroomId="chatroom-1" />
    </AttachmentsProvider>
  );
}

function textarea(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

function sendButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement;
}

function typeMessage(value: string) {
  fireEvent.change(textarea(), { target: { value } });
}

function scheduleItem(): HTMLElement | null {
  return screen.queryByRole('menuitem', { name: 'Schedule message' });
}

function openMenuWithRightClick() {
  fireEvent.contextMenu(sendButton());
  return screen.getByRole('menuitem', { name: 'Schedule message' });
}

function longPress() {
  vi.useFakeTimers();
  const button = sendButton();
  fireEvent.pointerDown(button, { pointerType: 'touch', clientX: 10, clientY: 10 });
  act(() => {
    vi.advanceTimersByTime(500);
  });
  return button;
}

describe('MessageInput schedule gestures', () => {
  beforeEach(() => {
    uploadJobs = [];
    mockSendMessage.mockClear();
    clearPendingScheduledPrompt();
    // Drafts persist to localStorage; a fake-timer advance can flush one and
    // leak text into the next test's composer.
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearPendingScheduledPrompt();
  });

  it('sends on a plain click and does not open the menu', async () => {
    renderComposer();
    typeMessage('hello');

    fireEvent.click(sendButton());

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1));
    expect(scheduleItem()).toBeNull();
    expect(getPendingScheduledPrompt()).toBeNull();
  });

  it('right-click opens the schedule menu without scheduling or sending', () => {
    renderComposer();
    typeMessage('hello world');

    openMenuWithRightClick();

    expect(scheduleItem()).toBeDefined();
    expect(getPendingScheduledPrompt()).toBeNull();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('choosing Schedule message requests the trimmed text and closes the menu', async () => {
    renderComposer();
    typeMessage('  hello world  ');

    fireEvent.click(openMenuWithRightClick());

    await waitFor(() => expect(scheduleItem()).toBeNull());
    expect(getPendingScheduledPrompt()?.prefill).toEqual({
      prompt: 'hello world',
      hasAttachments: false,
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('long-press opens the menu and the release neither sends nor chooses', () => {
    renderComposer();
    typeMessage('schedule me');

    const button = longPress();
    expect(scheduleItem()).toBeDefined();

    fireEvent.pointerUp(button, { pointerType: 'touch' });
    fireEvent.click(button);

    expect(scheduleItem()).toBeDefined();
    expect(getPendingScheduledPrompt()).toBeNull();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('a short tap sends and opens no menu', async () => {
    vi.useFakeTimers();
    renderComposer();
    typeMessage('quick tap');

    const button = sendButton();
    fireEvent.pointerDown(button, { pointerType: 'touch', clientX: 10, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.pointerUp(button, { pointerType: 'touch' });
    vi.useRealTimers();
    fireEvent.click(button);

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1));
    expect(scheduleItem()).toBeNull();
    expect(getPendingScheduledPrompt()).toBeNull();
  });

  it('cancels the long-press when the finger moves beyond the threshold', () => {
    vi.useFakeTimers();
    renderComposer();
    typeMessage('scrolling');

    const button = sendButton();
    fireEvent.pointerDown(button, { pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(button, { pointerType: 'touch', clientX: 80, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(button, { pointerType: 'touch' });

    expect(scheduleItem()).toBeNull();
    expect(getPendingScheduledPrompt()).toBeNull();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('closes the menu on Escape without scheduling and restores the textarea focus', async () => {
    renderComposer();
    typeMessage('keep me');
    textarea().focus();

    openMenuWithRightClick();
    await waitFor(() => expect(scheduleItem()).toHaveFocus());
    fireEvent.keyDown(scheduleItem()!, { key: 'Escape' });

    await waitFor(() => expect(scheduleItem()).toBeNull());
    expect(getPendingScheduledPrompt()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(textarea()));
  });

  it('opens with the Menu key and schedules with ArrowDown then Enter', async () => {
    renderComposer();
    typeMessage('keyboard draft');
    sendButton().focus();

    fireEvent.contextMenu(sendButton());
    expect(scheduleItem()).toBeDefined();
    await waitFor(() => expect(scheduleItem()).toHaveFocus());

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Enter' });

    expect(getPendingScheduledPrompt()?.prefill.prompt).toBe('keyboard draft');
  });

  it('restores the send button focus when a keyboard-opened menu is dismissed', async () => {
    renderComposer();
    typeMessage('keyboard dismiss');
    sendButton().focus();

    fireEvent.contextMenu(sendButton());
    await waitFor(() => expect(scheduleItem()).toHaveFocus());
    fireEvent.keyDown(scheduleItem()!, { key: 'Escape' });

    await waitFor(() => expect(scheduleItem()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(sendButton()));
    expect(getPendingScheduledPrompt()).toBeNull();
  });

  it('restores focus on a reopen after choosing Schedule message', async () => {
    renderComposer();
    typeMessage('first draft');
    textarea().focus();

    fireEvent.click(openMenuWithRightClick());
    await waitFor(() => expect(getPendingScheduledPrompt()).not.toBeNull());

    textarea().focus();
    fireEvent.contextMenu(sendButton());
    await waitFor(() => expect(scheduleItem()).toHaveFocus());
    fireEvent.keyDown(scheduleItem()!, { key: 'Escape' });

    await waitFor(() => expect(scheduleItem()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(textarea()));
  });

  it('restores focus to the send button when nothing was focused before a right-click', async () => {
    renderComposer();
    typeMessage('no focus');
    expect(document.activeElement).toBe(document.body);

    fireEvent.contextMenu(sendButton());
    await waitFor(() => expect(scheduleItem()).toHaveFocus());
    fireEvent.keyDown(scheduleItem()!, { key: 'Escape' });

    await waitFor(() => expect(scheduleItem()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(sendButton()));
  });

  it('clears the composer text only when the schedule request succeeds', async () => {
    renderComposer();
    typeMessage('draft to schedule');

    fireEvent.click(openMenuWithRightClick());
    const pending = getPendingScheduledPrompt();

    // Cancel path: the composer text is untouched.
    expect(textarea().value).toBe('draft to schedule');

    act(() => {
      pending?.onScheduled?.();
    });

    expect(textarea().value).toBe('');
    await waitFor(() => expect(scheduleItem()).toBeNull());
  });

  it('does nothing on right-click or long-press when there is no text', () => {
    renderComposer();

    fireEvent.contextMenu(sendButton());
    expect(scheduleItem()).toBeNull();

    longPress();
    expect(scheduleItem()).toBeNull();
    expect(getPendingScheduledPrompt()).toBeNull();
  });

  it('does nothing on right-click or long-press while uploads are active', () => {
    uploadJobs = [
      {
        id: 'job-1',
        phase: 'uploading',
        percent: 10,
        filePath: 'path/a.txt',
        fileName: 'a.txt',
      },
    ];
    renderComposer();
    typeMessage('blocked while uploading');
    expect(sendButton()).toBeDisabled();

    fireEvent.contextMenu(sendButton());
    expect(scheduleItem()).toBeNull();

    longPress();
    expect(scheduleItem()).toBeNull();
    expect(getPendingScheduledPrompt()).toBeNull();
  });

  it('marks the schedule request when attachments are present', async () => {
    renderComposer({ withAttachment: true });
    typeMessage('with an attachment');

    fireEvent.click(openMenuWithRightClick());

    await waitFor(() => expect(getPendingScheduledPrompt()).not.toBeNull());
    expect(getPendingScheduledPrompt()?.prefill).toEqual({
      prompt: 'with an attachment',
      hasAttachments: true,
    });
  });

  it('advertises the menu on the send button', () => {
    renderComposer();
    typeMessage('hello');
    expect(sendButton()).toHaveAttribute('title', 'Right-click or long-press to schedule');
    expect(sendButton()).toHaveAttribute('aria-haspopup', 'menu');
    expect(sendButton()).toHaveAttribute('aria-expanded', 'false');

    openMenuWithRightClick();
    expect(sendButton()).toHaveAttribute('aria-expanded', 'true');
  });
});
