/**
 * MessageInput — one-time new-session toggle.
 * Real StartInNewSessionPreferenceProvider + PlannerNewSessionToggle + MessageInput.
 * Only the Convex mutation boundary is substituted.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachmentsProvider } from '../attachments';
import { MessageInput } from './MessageInput';
import { StartInNewSessionPreferenceProvider } from '../hooks/useStartInNewSessionPreference';
import { PlannerNewSessionToggle } from './timeline/PlannerNewSessionToggle';

const mockSendMessage = vi.fn();

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
  api: { messages: { sendMessage: 'messages:sendMessage' } },
}));

vi.mock('../hooks/useConversationMode', () => ({
  useConversationMode: () => ({
    mode: 'code',
    setMode: vi.fn(),
    hasUserSelected: false,
  }),
}));

vi.mock('../hooks/useTriggerAutocomplete', () => ({
  useTriggerAutocomplete: () => ({
    state: { visible: false, results: [], selectedIndex: 0, position: null },
    handleInputChange: vi.fn(),
    handleKeyDown: vi.fn(() => false),
    handleSelect: vi.fn(),
    setSelectedIndex: vi.fn(),
  }),
}));

vi.mock('./FileReferenceAutocomplete', () => ({
  FileReferenceAutocomplete: () => null,
}));

vi.mock('../hooks/useChatInputFileDrop', () => ({
  useChatInputFileDrop: () => ({
    uploadJobs: [],
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
  }),
}));

vi.mock('../hooks/useFileReferenceAutocomplete', () => ({
  useFileReferenceAutocomplete: ({ onTextChange }: { onTextChange: (v: string) => void }) => ({
    autocompleteState: {
      visible: false,
      results: [],
      selectedIndex: 0,
      position: { top: 0, left: 0 },
    },
    handleTextareaChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onTextChange(e.target.value);
    },
    handleAutocompleteKeyDown: vi.fn(() => false),
    handleFileSelect: vi.fn(),
    setSelectedIndex: vi.fn(),
  }),
}));

vi.mock('../utils/pendingComposerFocus', () => ({
  takePendingComposerFocus: () => false,
}));

vi.mock('../workspace/files/workspaceFileTreeAutocompleteVisible', () => ({
  setFileTreeAutocompleteVisible: vi.fn(),
}));

const NEW_SESSION_ENVELOPE = {
  version: 1,
  conversationMode: 'code',
  sessionPolicy: 'new',
  handoffWorkflow: { preset: 'team', phase: 'entry' },
};
const CONTINUE_ENVELOPE = {
  version: 1,
  conversationMode: 'code',
  sessionPolicy: 'continue',
  handoffWorkflow: { preset: 'team', phase: 'entry' },
};

function renderComposer() {
  return render(
    <AttachmentsProvider>
      <StartInNewSessionPreferenceProvider>
        <PlannerNewSessionToggle />
        <MessageInput chatroomId="room-1" />
      </StartInNewSessionPreferenceProvider>
    </AttachmentsProvider>
  );
}

const toggle = () => screen.getByTestId('planner-new-session-toggle');
const textarea = () => screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
const sendButton = () => screen.getByRole('button', { name: 'Send message' });

function envelopeOf(callIndex: number) {
  return (mockSendMessage.mock.calls[callIndex][0] as { taskEnvelope: unknown }).taskEnvelope;
}

function typeAndPressEnter(value: string) {
  fireEvent.change(textarea(), { target: { value } });
  fireEvent.keyDown(textarea(), { key: 'Enter', shiftKey: false });
}

describe('MessageInput one-time new-session toggle', () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue('msg-id');
  });

  it('sends as a new session and turns the toggle off after an Enter send succeeds', async () => {
    renderComposer();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');

    typeAndPressEnter('start fresh');

    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'false'));
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(envelopeOf(0)).toEqual(NEW_SESSION_ENVELOPE);
  });

  it('turns the toggle off after a Send-button send succeeds', async () => {
    renderComposer();
    fireEvent.click(toggle());
    fireEvent.change(textarea(), { target: { value: 'via button' } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'false'));
    expect(envelopeOf(0)).toEqual(NEW_SESSION_ENVELOPE);
  });

  it('keeps the toggle on after a failed send so the retry still starts a new session', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('network down'));
    renderComposer();
    fireEvent.click(toggle());
    typeAndPressEnter('retry me');

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');

    // Failed send keeps the draft; press Enter again to retry.
    fireEvent.keyDown(textarea(), { key: 'Enter', shiftKey: false });

    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'false'));
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(envelopeOf(0)).toEqual(NEW_SESSION_ENVELOPE);
    expect(envelopeOf(1)).toEqual(NEW_SESSION_ENVELOPE);
  });

  it('sends the next message as a continuation without any user action', async () => {
    renderComposer();
    fireEvent.click(toggle());
    typeAndPressEnter('first');
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'false'));

    typeAndPressEnter('second');
    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(2));
    expect(envelopeOf(1)).toEqual(CONTINUE_ENVELOPE);
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
  });

  it('leaves an off toggle off and sends the continue policy', async () => {
    renderComposer();
    typeAndPressEnter('plain');

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1));
    expect(envelopeOf(0)).toEqual(CONTINUE_ENVELOPE);
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
  });
});
