import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GoogleAuthConfigPage from './page';

const mocks = vi.hoisted(() => ({
  config: null as unknown,
  updateConfig: vi.fn(),
  toggleEnabled: vi.fn(),
  testConfig: vi.fn(),
  resetConfig: vi.fn(),
  writeText: vi.fn(),
}));

// Data port: the Google Auth functions, keyed by their generated function names.
vi.mock('convex-helpers/react/sessions', async () => {
  const { getFunctionName } = await import('convex/server');
  return {
    useSessionQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === 'system/auth/google:getConfig') return mocks.config;
      throw new Error(`Unexpected query in GoogleAuthConfigPage test: ${name}`);
    },
    useSessionMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === 'system/auth/google:updateConfig') return mocks.updateConfig;
      if (name === 'system/auth/google:toggleEnabled') return mocks.toggleEnabled;
      if (name === 'system/auth/google:resetConfig') return mocks.resetConfig;
      throw new Error(`Unexpected mutation in GoogleAuthConfigPage test: ${name}`);
    },
    useSessionAction: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === 'system/auth/google:testConfig') return mocks.testConfig;
      throw new Error(`Unexpected action in GoogleAuthConfigPage test: ${name}`);
    },
  };
});

// Data port: app info only serves the page loading gate here.
vi.mock('@/modules/app/useAppInfo', () => ({
  useAppInfo: () => ({ isLoading: false, appInfo: null, error: null, refetch: vi.fn() }),
}));

const existingConfig = {
  type: 'google',
  enabled: false,
  projectId: '',
  clientId: '123-abc.apps.googleusercontent.com',
  clientSecret: undefined,
  hasClientSecret: true,
  isConfigured: true,
  redirectUris: [],
  configuredBy: 'admin',
  configuredAt: 0,
};

const CLIENT_ID = '123-abc.apps.googleusercontent.com';

let user: ReturnType<typeof userEvent.setup>;

async function typeClientId() {
  await user.type(screen.getByLabelText('Google Client ID'), CLIENT_ID);
}

async function typeClientSecret() {
  await user.type(screen.getByLabelText('Google Client Secret'), 'secret');
}

async function clickSave() {
  await user.click(screen.getByRole('button', { name: /Save Configuration/ }));
}

async function clickTest() {
  await user.click(screen.getByRole('button', { name: /Test Configuration/ }));
}

describe('GoogleAuthConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config = null;
    mocks.updateConfig.mockResolvedValue({ success: true, message: 'Saved' });
    mocks.toggleEnabled.mockResolvedValue({ success: true, message: 'Toggled' });
    mocks.testConfig.mockResolvedValue({ success: true, message: 'OK' });
    mocks.resetConfig.mockResolvedValue({ success: true, message: 'Reset' });
    mocks.writeText.mockResolvedValue(undefined);
    user = userEvent.setup({ writeToClipboard: false });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a valid test result verbatim as status text with no icon', async () => {
    mocks.testConfig.mockResolvedValueOnce({ success: true, message: 'OK' });

    render(<GoogleAuthConfigPage />);
    await typeClientId();
    await clickTest();

    const status = await screen.findByTestId('google-auth-feedback');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent('✅ Configuration is valid: OK');
    // `icon: false` drops the tone icon; the Dismiss X below lives inside its button.
    expect(status.querySelector(':scope > svg')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a failed test result verbatim as alert text with no icon', async () => {
    mocks.testConfig.mockResolvedValueOnce({ success: false, message: 'Bad secret' });

    render(<GoogleAuthConfigPage />);
    await typeClientId();
    await clickTest();

    const alert = await screen.findByTestId('google-auth-feedback');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('❌ Configuration failed: Bad secret');
    expect(alert.querySelector(':scope > svg')).toBeNull();
  });

  it('clears the test result when the next Save starts', async () => {
    mocks.testConfig.mockResolvedValueOnce({ success: true, message: 'OK' });

    render(<GoogleAuthConfigPage />);
    await typeClientId();
    await typeClientSecret();
    await clickTest();
    expect(await screen.findByTestId('google-auth-feedback')).toBeInTheDocument();

    await clickSave();

    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalled());
    expect(screen.queryByTestId('google-auth-feedback')).toBeNull();
  });

  it('shows a missing Client ID as alert text with the default icon', async () => {
    render(<GoogleAuthConfigPage />);
    await clickSave();

    const alert = await screen.findByTestId('google-auth-feedback');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('Client ID is required');
    expect(alert.querySelector(':scope > svg')).not.toBeNull();
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });

  it('shows a failed toggle as alert text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.toggleEnabled.mockRejectedValueOnce(new Error('toggle boom'));

    render(<GoogleAuthConfigPage />);
    await user.click(screen.getByRole('switch'));

    const alert = await screen.findByTestId('google-auth-feedback');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('Failed to toggle Google Auth. Please try again.');
  });

  it('shows a failed save as alert text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.updateConfig.mockRejectedValueOnce(new Error('save boom'));

    render(<GoogleAuthConfigPage />);
    await typeClientId();
    await typeClientSecret();
    await clickSave();

    const alert = await screen.findByTestId('google-auth-feedback');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('Failed to save configuration. Please try again.');
  });

  it('shows a failed reset as alert text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.config = existingConfig;
    mocks.resetConfig.mockRejectedValueOnce(new Error('reset boom'));

    render(<GoogleAuthConfigPage />);
    await user.click(await screen.findByRole('button', { name: /Reset Configuration/ }));

    const alert = await screen.findByTestId('google-auth-feedback');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('Failed to reset configuration. Please try again.');
  });

  it('renders nothing when save, toggle and reset succeed', async () => {
    mocks.config = existingConfig;

    render(<GoogleAuthConfigPage />);
    await user.click(screen.getByRole('switch'));
    await waitFor(() => expect(mocks.toggleEnabled).toHaveBeenCalled());

    await typeClientSecret();
    await clickSave();
    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /Reset Configuration/ }));
    await waitFor(() => expect(mocks.resetConfig).toHaveBeenCalled());

    expect(screen.queryByTestId('google-auth-feedback')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a rejected clipboard write as alert text through CopyButton', async () => {
    mocks.writeText.mockRejectedValueOnce(new Error('denied'));

    render(<GoogleAuthConfigPage />);
    await user.click(screen.getAllByRole('button', { name: 'Copy' })[0]);

    const alert = await screen.findByTestId('google-auth-feedback');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('Failed to copy to clipboard');
  });
});
