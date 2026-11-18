import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  sendMessage: vi.fn(),
  validateBotToken: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => mocks.list(),
  useSessionMutation: (mutation: unknown) => {
    const name = String(mutation).split('.').pop();
    if (name === 'create') return mocks.create;
    if (name === 'update') return mocks.update;
    if (name === 'remove') return mocks.remove;
    return vi.fn();
  },
  useSessionAction: (action: unknown) => {
    const name = String(action).split('.').pop();
    if (name === 'validateBotToken') return mocks.validateBotToken;
    if (name === 'sendMessage') return mocks.sendMessage;
    return vi.fn();
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    integrations: {
      list: 'integrations.list',
      create: 'integrations.create',
      update: 'integrations.update',
      remove: 'integrations.remove',
      telegram: {
        actions: {
          validateBotToken: 'integrations.telegram.actions.validateBotToken',
          sendMessage: 'integrations.telegram.actions.sendMessage',
        },
      },
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

const TELEGRAM_CHAT_ID = '32319784';

function makeIntegration(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'integ-1',
    _creationTime: 0,
    chatroomId: 'room-1',
    platform: 'telegram',
    config: { botToken: '123456:secret', chatId: TELEGRAM_CHAT_ID },
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** The delete control is icon-only, so scope to the card and take its unnamed button. */
function getTrashButton(card: HTMLElement): HTMLElement {
  const buttons = within(card).getAllByRole('button');
  const trash = buttons.find((button) => !button.textContent?.trim());
  if (!trash) throw new Error('trash button not found');
  return trash;
}

function getCard(): HTMLElement {
  const card = screen.getByText('Telegram').closest('div.border');
  if (!card) throw new Error('integration card not found');
  return card as HTMLElement;
}

describe('IntegrationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loading, empty and populated states', () => {
    it('shows a skeleton instead of the empty state while loading', async () => {
      mocks.list.mockReturnValue(undefined);

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      expect(screen.getByTestId('integrations-loading')).toBeInTheDocument();
      expect(screen.queryByText('No integrations configured')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add Integration' })).not.toBeInTheDocument();
    });

    it('shows the empty state with a single Add Integration button when there are none', async () => {
      mocks.list.mockReturnValue([]);

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      expect(screen.getByText('No integrations configured')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add Integration' })).toBeInTheDocument();
      expect(screen.queryByTestId('integrations-loading')).not.toBeInTheDocument();
    });

    it('shows rows plus the header Add Integration button when populated', async () => {
      mocks.list.mockReturnValue([makeIntegration()]);

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      expect(screen.getByText('Telegram')).toBeInTheDocument();
      expect(screen.getByText(`Chat ID: ${TELEGRAM_CHAT_ID}`)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add Integration' })).toBeInTheDocument();
      expect(screen.queryByText('No integrations configured')).not.toBeInTheDocument();
    });
  });

  describe('setup wizard', () => {
    it('closes on connect, toasts once and highlights the new row', async () => {
      let rows: ReturnType<typeof makeIntegration>[] = [];
      mocks.list.mockImplementation(() => rows);
      mocks.validateBotToken.mockResolvedValue({
        botId: 1,
        botName: 'TestBot',
        botUsername: 'test_bot',
      });
      mocks.create.mockImplementation(async () => {
        rows = [makeIntegration({ _id: 'integ-new' })];
        return 'integ-new';
      });

      const { IntegrationsTab } = await import('./IntegrationsTab');
      const { container } = render(<IntegrationsTab chatroomId="room-1" />);

      fireEvent.click(screen.getByRole('button', { name: 'Add Integration' }));

      const tokenInput = screen.getByPlaceholderText('123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11');
      fireEvent.change(tokenInput, { target: { value: '123456:secret' } });
      fireEvent.click(screen.getByRole('button', { name: /Validate Token/ }));

      const chatIdInput = await screen.findByPlaceholderText('-1001234567890');
      fireEvent.change(chatIdInput, { target: { value: TELEGRAM_CHAT_ID } });
      fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

      expect(await screen.findByText('TestBot')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Connect Bot/ }));

      await waitFor(() => {
        expect(screen.queryByText('Connect Telegram Bot')).not.toBeInTheDocument();
      });

      expect(mocks.create).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        platform: 'telegram',
        config: { botToken: '123456:secret', chatId: TELEGRAM_CHAT_ID },
        enabled: true,
      });
      expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Telegram connected', {
        description: 'Use Test on the new row to send a message.',
      });

      expect(screen.queryByText('Telegram connected!')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();

      const highlighted = container.querySelector('.border-chatroom-status-success\\/40');
      expect(highlighted).not.toBeNull();
      expect(highlighted).toHaveClass('bg-chatroom-status-success/5');
    });

    it('shows the validation error and re-enables the token input', async () => {
      mocks.list.mockReturnValue([]);
      mocks.validateBotToken.mockRejectedValue(new Error('Invalid bot token'));

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      fireEvent.click(screen.getByRole('button', { name: 'Add Integration' }));
      const tokenInput = screen.getByPlaceholderText('123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11');
      fireEvent.change(tokenInput, { target: { value: 'bad-token' } });
      fireEvent.click(screen.getByRole('button', { name: /Validate Token/ }));

      expect(await screen.findByText('Invalid bot token')).toBeInTheDocument();
      expect(tokenInput).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /Validate Token/ })).not.toBeDisabled();
    });

    it('shows the create error and lets Connect Bot be retried', async () => {
      mocks.list.mockReturnValue([]);
      mocks.validateBotToken.mockResolvedValue({
        botId: 1,
        botName: 'TestBot',
        botUsername: null,
      });
      mocks.create.mockRejectedValue(new Error('Bot is already connected'));

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      fireEvent.click(screen.getByRole('button', { name: 'Add Integration' }));
      fireEvent.change(screen.getByPlaceholderText('123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11'), {
        target: { value: '123456:secret' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Validate Token/ }));

      fireEvent.change(await screen.findByPlaceholderText('-1001234567890'), {
        target: { value: TELEGRAM_CHAT_ID },
      });
      fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
      fireEvent.click(await screen.findByRole('button', { name: /Connect Bot/ }));

      expect(await screen.findByText('Bot is already connected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Connect Bot/ })).not.toBeDisabled();
    });

    it('keeps the header Add Integration button visible but disabled while the wizard is open', async () => {
      mocks.list.mockReturnValue([makeIntegration()]);

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      const headerButton = screen.getByRole('button', { name: 'Add Integration' });
      expect(headerButton).not.toBeDisabled();

      fireEvent.click(headerButton);

      expect(screen.getByText('Connect Telegram Bot')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add Integration' })).toBeDisabled();
    });
  });

  describe('connected row', () => {
    it('shows the Active badge and enabled Test for an enabled integration', async () => {
      mocks.list.mockReturnValue([makeIntegration()]);

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.queryByText('Disabled')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Test/ })).not.toBeDisabled();
    });

    it('shows the Disabled badge and disables Test for a disabled integration', async () => {
      mocks.list.mockReturnValue([makeIntegration({ enabled: false })]);

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      expect(screen.getByText('Disabled')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Test/ })).toBeDisabled();
    });

    it('toggles with the inverse of the current value', async () => {
      mocks.list.mockReturnValue([makeIntegration()]);
      mocks.update.mockResolvedValue(undefined);

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      fireEvent.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(mocks.update).toHaveBeenCalledWith({
          integrationId: 'integ-1',
          enabled: false,
        });
      });
    });

    it('toasts when the toggle fails', async () => {
      mocks.list.mockReturnValue([makeIntegration()]);
      mocks.update.mockRejectedValue(new Error('Toggle failed'));

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      fireEvent.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(mocks.toastError).toHaveBeenCalledWith('Toggle failed');
      });
    });
  });

  describe('test message panel', () => {
    it('sends a message, shows the success line and closes after 2 seconds', async () => {
      vi.useFakeTimers();
      mocks.list.mockReturnValue([makeIntegration()]);
      mocks.sendMessage.mockResolvedValue(undefined);

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      fireEvent.click(screen.getByRole('button', { name: /Test/ }));
      const input = screen.getByPlaceholderText('Type a test message...');
      fireEvent.change(input, { target: { value: 'hello there' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Send/ }));
      });

      expect(mocks.sendMessage).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        message: 'hello there',
        senderRole: 'user',
      });
      expect(screen.getByText('Sent!')).toBeInTheDocument();
      expect(screen.getByText('✅ Message sent to Telegram!')).toBeInTheDocument();
      expect(screen.getByText('Send Test Message')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(screen.queryByText('Send Test Message')).not.toBeInTheDocument();
    });

    it('shows the error and keeps Send usable on failure', async () => {
      mocks.list.mockReturnValue([makeIntegration()]);
      mocks.sendMessage.mockRejectedValue(new Error('Telegram is unreachable'));

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      fireEvent.click(screen.getByRole('button', { name: /Test/ }));
      fireEvent.change(screen.getByPlaceholderText('Type a test message...'), {
        target: { value: 'hello' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Send/ }));

      expect(await screen.findByText('Telegram is unreachable')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Send/ })).not.toBeDisabled();
    });

    it('sends on Enter', async () => {
      mocks.list.mockReturnValue([makeIntegration()]);
      mocks.sendMessage.mockResolvedValue(undefined);

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      fireEvent.click(screen.getByRole('button', { name: /Test/ }));
      const input = screen.getByPlaceholderText('Type a test message...');
      fireEvent.change(input, { target: { value: 'enter message' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(mocks.sendMessage).toHaveBeenCalledWith({
          chatroomId: 'room-1',
          message: 'enter message',
          senderRole: 'user',
        });
      });
    });
  });

  describe('delete confirmation', () => {
    it('opens the dialog and Cancel closes it without removing', async () => {
      mocks.list.mockReturnValue([makeIntegration()]);

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      fireEvent.click(getTrashButton(getCard()));
      expect(await screen.findByText('Remove Telegram integration?')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(screen.queryByText('Remove Telegram integration?')).not.toBeInTheDocument();
      });
      expect(mocks.remove).not.toHaveBeenCalled();
    });

    it('removes once and closes the dialog on success', async () => {
      mocks.list.mockReturnValue([makeIntegration()]);
      mocks.remove.mockResolvedValue(undefined);

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      fireEvent.click(getTrashButton(getCard()));
      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(mocks.remove).toHaveBeenCalledTimes(1);
      });
      expect(mocks.remove).toHaveBeenCalledWith({ integrationId: 'integ-1' });
      await waitFor(() => {
        expect(screen.queryByText('Remove Telegram integration?')).not.toBeInTheDocument();
      });
    });

    it('keeps the dialog open with an inline error when removal fails', async () => {
      mocks.list.mockReturnValue([makeIntegration()]);
      mocks.remove.mockRejectedValue(new Error('Cannot delete integration'));

      const { IntegrationsTab } = await import('./IntegrationsTab');
      render(<IntegrationsTab chatroomId="room-1" />);

      fireEvent.click(getTrashButton(getCard()));
      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      expect(await screen.findByText('Cannot delete integration')).toBeInTheDocument();
      expect(screen.getByText('Remove Telegram integration?')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled();
      expect(mocks.toastError).toHaveBeenCalledWith('Cannot delete integration');
    });
  });
});
