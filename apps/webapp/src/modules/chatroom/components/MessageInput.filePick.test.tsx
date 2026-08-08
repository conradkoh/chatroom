/**
 * MessageInput — file picker (paperclip button) tests
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageInput } from './MessageInput';
import { AttachmentsProvider } from '../attachments';

let touchDevice = true;
let mockFileInputRef: { current: HTMLInputElement | null };
const mockHandleAttachClick = vi.fn();

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: touchDevice && query.includes('coarse'),
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
  useSessionMutation: () => vi.fn().mockResolvedValue('msg-id'),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    messages: {
      sendMessage: 'messages:sendMessage',
    },
  },
}));

vi.mock('../hooks/useChatInputFileDrop', () => ({
  useChatInputFileDrop: () => ({
    uploadJobs: [],
    isDragging: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    fileInputRef: mockFileInputRef,
    handleAttachClick: mockHandleAttachClick,
    handleFileInputChange: vi.fn(),
  }),
}));

describe('MessageInput file picker', () => {
  beforeEach(() => {
    touchDevice = true;
    mockFileInputRef = { current: null };
    mockHandleAttachClick.mockClear();
    mockHandleAttachClick.mockImplementation(() => mockFileInputRef.current?.click());
  });

  it('shows attach button on touch devices', () => {
    render(
      <AttachmentsProvider>
        <MessageInput chatroomId="chatroom-1" />
      </AttachmentsProvider>
    );

    expect(screen.getByRole('button', { name: 'Add attachment' })).toBeInTheDocument();
  });

  it('shows attach button on non-touch (desktop) devices', () => {
    touchDevice = false;

    render(
      <AttachmentsProvider>
        <MessageInput chatroomId="chatroom-1" />
      </AttachmentsProvider>
    );

    expect(screen.getByRole('button', { name: 'Add attachment' })).toBeInTheDocument();
  });

  it('clicking attach button triggers file input click', () => {
    const { container } = render(
      <AttachmentsProvider>
        <MessageInput chatroomId="chatroom-1" />
      </AttachmentsProvider>
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }));

    expect(mockHandleAttachClick).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('places Add attachment above input row, not beside send', () => {
    render(
      <AttachmentsProvider>
        <MessageInput chatroomId="chatroom-1" />
      </AttachmentsProvider>
    );

    const addBtn = screen.getByRole('button', { name: 'Add attachment' });
    const sendBtn = screen.getByRole('button', { name: 'Send message' });
    const inputRow = sendBtn.closest('.flex.items-center.gap-1\\.5');
    expect(inputRow).toBeTruthy();
    expect(inputRow?.contains(addBtn)).toBe(false);
    expect(screen.getByText('Add Attachment')).toBeInTheDocument();
  });
});
