import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GoogleAuthConfigPage from './page';

const mocks = vi.hoisted(() => ({
  config: undefined as unknown,
  toggleEnabled: vi.fn(),
  updateConfig: vi.fn(),
  testConfig: vi.fn(),
  resetConfig: vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    system: {
      auth: {
        google: {
          getConfig: 'system/auth/google:getConfig',
          toggleEnabled: 'system/auth/google:toggleEnabled',
          updateConfig: 'system/auth/google:updateConfig',
          testConfig: 'system/auth/google:testConfig',
          resetConfig: 'system/auth/google:resetConfig',
        },
      },
    },
  },
}));
vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => mocks.config,
  useSessionMutation: (ref: string) =>
    ({
      'system/auth/google:toggleEnabled': mocks.toggleEnabled,
      'system/auth/google:updateConfig': mocks.updateConfig,
      'system/auth/google:resetConfig': mocks.resetConfig,
    })[ref],
  useSessionAction: () => mocks.testConfig,
}));
vi.mock('@/modules/app/useAppInfo', () => ({
  useAppInfo: () => ({ isLoading: false }),
}));

const origin = window.location.origin;
const redirectUri = `${origin}/api/auth/google/callback`;
const VALID_CLIENT_ID = '123456789012-abcdefg.apps.googleusercontent.com';
const configured = {
  enabled: false,
  projectId: '',
  clientId: VALID_CLIENT_ID,
  isConfigured: true,
  hasClientSecret: true,
};

beforeEach(() => {
  mocks.config = {
    enabled: false,
    projectId: '',
    clientId: '',
    isConfigured: false,
    hasClientSecret: false,
  };
  mocks.toggleEnabled.mockReset().mockResolvedValue({ success: true, message: '' });
  mocks.updateConfig.mockReset().mockResolvedValue({ success: true, message: '' });
  mocks.testConfig.mockReset().mockResolvedValue({ success: true, message: 'ok' });
  mocks.resetConfig.mockReset().mockResolvedValue({ success: true, message: '' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The Copy button in the read-only row that shows `value`. */
function copyButtonFor(value: string) {
  const input = screen.getByDisplayValue(value);
  return within(input.parentElement as HTMLElement).getByRole('button');
}

function getToggle() {
  return screen.getByRole('switch');
}

function saveButton() {
  return screen.getByRole('button', { name: 'Save Configuration' });
}

function testButton() {
  return screen.getByRole('button', { name: 'Test Configuration' });
}

function resetButton() {
  return screen.getByRole('button', { name: 'Reset Configuration' });
}

function clientIdInput() {
  return screen.getByLabelText('Google Client ID');
}

function clientSecretInput() {
  return screen.getByLabelText('Google Client Secret');
}

function alerts() {
  return screen.queryAllByRole('alert');
}

describe('GoogleAuthConfigPage copy rows', () => {
  it('swaps Copy to Copied with a check icon for 2 seconds, then reverts; other rows are unaffected', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<GoogleAuthConfigPage />);

    await user.click(copyButtonFor(origin));

    expect(writeText).toHaveBeenCalledWith(origin);
    const copied = await screen.findByRole('button', { name: 'Copied' });
    expect(copied.querySelector('.lucide-check')).not.toBeNull();
    expect(copyButtonFor(redirectUri)).toHaveAccessibleName('Copy');

    await waitFor(() => expect(copyButtonFor(origin)).toHaveAccessibleName('Copy'), {
      timeout: 3000,
    });
  });

  it('shows the copy failure under that row and clears it on the next copy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // the hook logs the rejection
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined);
    render(<GoogleAuthConfigPage />);

    await user.click(copyButtonFor(origin));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to copy to clipboard');
    expect(alert.parentElement).toContainElement(screen.getByDisplayValue(origin));
    expect(copyButtonFor(origin)).toHaveAccessibleName('Copy');

    await user.click(copyButtonFor(origin));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('GoogleAuthConfigPage enable toggle', () => {
  it('shows one alert under the switch row when the toggle is rejected, and the switch stays off', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.toggleEnabled.mockReset().mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);

    await user.click(getToggle());

    expect(mocks.toggleEnabled).toHaveBeenCalledWith({ enabled: true });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to toggle Google Auth. Please try again.');
    expect(alert.previousElementSibling).toContainElement(getToggle());
    expect(getToggle()).toHaveAttribute('aria-checked', 'false');
  });

  it('clears the alert when the next toggle starts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.toggleEnabled
      .mockReset()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ success: true, message: '' });
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);
    await user.click(getToggle());
    await screen.findByRole('alert');

    await user.click(getToggle());

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows no message when the toggle succeeds', async () => {
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);

    await user.click(getToggle());

    await waitFor(() => expect(getToggle()).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByText('Users can sign in with Google')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('GoogleAuthConfigPage save validation', () => {
  it('shows both field messages at once, marks both inputs invalid, and does not save', async () => {
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);

    await user.click(saveButton());

    expect(await screen.findByText('Client ID is required')).toBeInTheDocument();
    expect(screen.getByText('Client Secret is required for new configuration')).toBeInTheDocument();
    expect(clientIdInput()).toHaveAttribute('aria-invalid', 'true');
    expect(clientIdInput()).toHaveAttribute('aria-describedby', 'clientId-error');
    expect(clientSecretInput()).toHaveAttribute('aria-invalid', 'true');
    expect(clientSecretInput()).toHaveAttribute('aria-describedby', 'clientSecret-error');
    // Two field messages, no action Alert: each failure is reported once
    expect(alerts()).toHaveLength(2);
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });

  it('clears a field message when that field is edited, and leaves the other one', async () => {
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);
    await user.click(saveButton());
    await screen.findByText('Client ID is required');

    await user.type(clientIdInput(), '1');

    expect(screen.queryByText('Client ID is required')).not.toBeInTheDocument();
    expect(clientIdInput()).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText('Client Secret is required for new configuration')).toBeInTheDocument();
    expect(alerts()).toHaveLength(1);
  });

  it('reports the Client ID when Test is clicked with an empty Client ID', async () => {
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);
    await user.type(clientSecretInput(), 'secret');

    await user.click(testButton());

    expect(
      await screen.findByText('Please enter a Client ID to test the configuration')
    ).toBeInTheDocument();
    expect(clientIdInput()).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.testConfig).not.toHaveBeenCalled();
    expect(alerts()).toHaveLength(1);
  });
});

describe('GoogleAuthConfigPage test configuration', () => {
  it('shows a default Alert with the message when the test succeeds', async () => {
    mocks.testConfig.mockResolvedValueOnce({ success: true, message: 'Client reachable' });
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);
    await user.type(clientIdInput(), VALID_CLIENT_ID);

    await user.click(testButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Configuration is valid: Client reachable');
    expect(alert).not.toHaveClass('text-destructive');
  });

  it('shows a destructive Alert when the test reports success: false', async () => {
    mocks.testConfig.mockResolvedValueOnce({ success: false, message: 'Invalid client' });
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);
    await user.type(clientIdInput(), VALID_CLIENT_ID);

    await user.click(testButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Configuration failed: Invalid client');
    expect(alert).toHaveClass('text-destructive');
  });

  it('shows a destructive Alert when the test call throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.testConfig.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);
    await user.type(clientIdInput(), VALID_CLIENT_ID);

    await user.click(testButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to test configuration. Please try again.');
    expect(alert).toHaveClass('text-destructive');
  });

  it('disables Test with a spinner while the test is pending, then re-enables it', async () => {
    let finish!: (value: { success: boolean; message: string }) => void;
    mocks.testConfig.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);
    await user.type(clientIdInput(), VALID_CLIENT_ID);

    await user.click(testButton());

    expect(testButton()).toBeDisabled();
    expect(testButton().querySelector('.animate-spin')).not.toBeNull();

    await act(async () => {
      finish({ success: true, message: 'ok' });
    });

    await waitFor(() => expect(testButton()).toBeEnabled());
    expect(testButton().querySelector('.animate-spin')).toBeNull();
  });

  it('clears the result Alert when a Client ID edit happens', async () => {
    mocks.testConfig.mockResolvedValueOnce({ success: false, message: 'Invalid client' });
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);
    await user.type(clientIdInput(), VALID_CLIENT_ID);
    await user.click(testButton());
    await screen.findByRole('alert');

    await user.type(clientIdInput(), 'x');

    expect(alerts()).toHaveLength(0);
  });

  it('clears the result Alert at the start of the next Save', async () => {
    mocks.config = { ...configured };
    mocks.testConfig.mockResolvedValueOnce({ success: false, message: 'Invalid client' });
    let finishSave!: (value: { success: boolean; message: string }) => void;
    mocks.updateConfig.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSave = resolve;
      })
    );
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);
    await user.click(testButton());
    await screen.findByRole('alert');

    await user.click(saveButton());

    expect(alerts()).toHaveLength(0);
    await act(async () => {
      finishSave({ success: true, message: '' });
    });
  });
});

describe('GoogleAuthConfigPage save result', () => {
  it('shows a default Alert when saving an already-configured configuration succeeds', async () => {
    mocks.config = { ...configured };
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);

    await user.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Google Auth configuration saved successfully');
    expect(alert).not.toHaveClass('text-destructive');
    expect(mocks.updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: VALID_CLIENT_ID })
    );
  });

  it('shows a destructive Alert when save fails', async () => {
    mocks.config = { ...configured };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.updateConfig.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);

    await user.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to save configuration. Please try again.');
    expect(alert).toHaveClass('text-destructive');
  });
});

describe('GoogleAuthConfigPage reset', () => {
  it('resets silently: no message, and the fields clear', async () => {
    mocks.config = { ...configured };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);

    await user.click(resetButton());

    await waitFor(() => expect(clientIdInput()).toHaveValue(''));
    expect(alerts()).toHaveLength(0);
    expect(mocks.resetConfig).toHaveBeenCalled();
  });

  it('shows a destructive Alert when reset fails', async () => {
    mocks.config = { ...configured };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.resetConfig.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(<GoogleAuthConfigPage />);

    await user.click(resetButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to reset configuration. Please try again.');
    expect(alert).toHaveClass('text-destructive');
  });
});
