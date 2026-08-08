/**
 * MessageInput — mobile safe-area padding tests
 *
 * Verifies MessageInput (mid-stack, above WorkspaceBottomBar) applies only
 * horizontal safe-area padding and never owns the bottom inset.
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

vi.mock('./shared/chatroomMobileSafeArea', () => ({
  // Only the horizontal helper is exported: if MessageInput ever regresses to
  // the full (bottom-inset) helper, the import becomes undefined and the render
  // throws, failing this suite.
  getChatroomMobileFooterHorizontalSafeAreaStyle: (mobile: boolean) =>
    mobile
      ? {
          paddingLeft: '12px',
          paddingRight: '13px',
        }
      : {},
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

  it('applies horizontal safe-area padding only on mobile (no paddingBottom)', () => {
    render(
      <AttachmentsProvider>
        <MessageInput chatroomId="chatroom-1" />
      </AttachmentsProvider>
    );

    const composer = document.querySelector('[data-main-chat-composer]') as HTMLElement;
    expect(composer.style.paddingLeft).toBe('12px');
    expect(composer.style.paddingRight).toBe('13px');
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
