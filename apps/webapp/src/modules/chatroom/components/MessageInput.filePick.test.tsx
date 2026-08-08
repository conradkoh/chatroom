/**
 * MessageInput — file picker (paperclip button) tests
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageInput } from './MessageInput';
import { AttachmentsProvider } from '../attachments';

const mockUseIsDesktop = vi.fn();
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

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

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
    mockUseIsDesktop.mockReturnValue(false);
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

    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument();
  });

  it('shows attach button on non-touch (desktop) devices', () => {
    touchDevice = false;

    render(
      <AttachmentsProvider>
        <MessageInput chatroomId="chatroom-1" />
      </AttachmentsProvider>
    );

    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument();
  });

  it('clicking attach button triggers file input click', () => {
    const { container } = render(
      <AttachmentsProvider>
        <MessageInput chatroomId="chatroom-1" />
      </AttachmentsProvider>
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));

    expect(mockHandleAttachClick).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });
});
