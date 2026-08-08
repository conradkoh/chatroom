/**
 * MessageInput — mobile safe-area padding tests
 *
 * MessageInput must NOT apply horizontal safe-area padding on mobile.
 * Horizontal alignment comes from px-2 on inner rows (same as desktop).
 * Only WorkspaceBottomBar owns bottom + horizontal safe-area for the footer stack.
 */

import { render } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageInput } from './MessageInput';
import { AttachmentsProvider } from '../attachments';

const mockUseIsDesktop = vi.fn();

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

vi.mock('./EditorModal', () => ({
  EditorModal: () => null,
}));

vi.mock('../hooks/useChatInputFileDrop', () => ({
  useChatInputFileDrop: () => ({
    uploadJobs: [],
    isDragging: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
  }),
}));

describe('MessageInput mobile safe-area', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(false);
  });

  it('does not apply horizontal safe-area padding on mobile', () => {
    render(
      <AttachmentsProvider>
        <MessageInput chatroomId="chatroom-1" />
      </AttachmentsProvider>
    );

    const composer = document.querySelector('[data-main-chat-composer]') as HTMLElement;
    expect(composer.style.paddingLeft).toBe('');
    expect(composer.style.paddingRight).toBe('');
    expect(composer.style.paddingBottom).toBe('');
  });

  it('does not apply safe-area padding on desktop', () => {
    mockUseIsDesktop.mockReturnValue(true);

    render(
      <AttachmentsProvider>
        <MessageInput chatroomId="chatroom-1" />
      </AttachmentsProvider>
    );

    const composer = document.querySelector('[data-main-chat-composer]') as HTMLElement;
    expect(composer.style.cssText).toBe('');
  });
});
