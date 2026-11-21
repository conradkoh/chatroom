import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NameEditForm } from './NameEditForm';

import type * as GoogleOAuthModule from '@/modules/auth/google-oauth';

const mocks = vi.hoisted(() => ({
  user: undefined as unknown,
  updateUserName: vi.fn(),
  disconnectGoogle: vi.fn(),
  createConnectRequest: vi.fn(),
  redirectToGoogleOAuth: vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    auth: {
      updateUserName: 'auth:updateUserName',
      google: {
        getConfig: 'auth:google:getConfig',
        disconnectGoogle: 'auth:google:disconnectGoogle',
        createConnectRequest: 'auth:google:createConnectRequest',
      },
    },
  },
}));
vi.mock('convex/react', () => ({
  useQuery: () => ({ enabled: true, clientId: 'test-client-id' }),
}));
vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (ref: string) =>
    ({
      'auth:updateUserName': mocks.updateUserName,
      'auth:google:disconnectGoogle': mocks.disconnectGoogle,
      'auth:google:createConnectRequest': mocks.createConnectRequest,
    })[ref],
}));
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuthState: () => ({ state: 'authenticated', authMethod: 'google', user: mocks.user }),
  useCurrentUser: () => mocks.user,
}));
vi.mock('@/modules/auth/google-oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof GoogleOAuthModule>();
  return { ...actual, redirectToGoogleOAuth: mocks.redirectToGoogleOAuth };
});

const anonymousUser = { _id: 'user-1', _creationTime: 0, type: 'anonymous', name: 'Ada' };
const googleUser = {
  _id: 'user-1',
  _creationTime: 0,
  type: 'full',
  name: 'Ada',
  email: 'ada@example.com',
  google: { email: 'ada@example.com' },
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openDisconnectDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Connected/ }));
  await user.click(await screen.findByRole('menuitem', { name: 'Disconnect' }));
  return screen.findByRole('alertdialog');
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user = anonymousUser;
  mocks.createConnectRequest.mockResolvedValue({ connectId: 'connect-1' });
  mocks.disconnectGoogle.mockResolvedValue(undefined);
});

describe('NameEditForm Google connect feedback', () => {
  it('shows one alert under the Google row when connect is rejected', async () => {
    mocks.createConnectRequest.mockRejectedValue(new Error('boom'));
    render(<NameEditForm />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Connect' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to connect Google account');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    const googleSection = within(alert.parentElement as HTMLElement);
    expect(googleSection.getByRole('button', { name: 'Connect' })).toBeEnabled();
    expect(mocks.redirectToGoogleOAuth).not.toHaveBeenCalled();
  });

  it('clears the connect alert when the next attempt starts', async () => {
    const second = deferred<{ connectId: string }>();
    mocks.createConnectRequest
      .mockRejectedValueOnce(new Error('boom'))
      .mockReturnValueOnce(second.promise);
    render(<NameEditForm />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connecting...' })).toBeDisabled();

    second.reject(new Error('boom again'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to connect Google account');
  });

  it('shows no alert when connect succeeds', async () => {
    render(<NameEditForm />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() =>
      expect(mocks.redirectToGoogleOAuth).toHaveBeenCalledWith(
        expect.stringContaining('https://accounts.google.com/')
      )
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('NameEditForm Google disconnect feedback', () => {
  it('keeps the dialog open and shows one alert inside it when disconnect is rejected', async () => {
    mocks.user = googleUser;
    mocks.disconnectGoogle.mockRejectedValue(new Error('boom'));
    render(<NameEditForm />);
    const user = userEvent.setup();
    const dialog = await openDisconnectDialog(user);

    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Failed to disconnect Google account'
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Disconnect' })).toBeEnabled();
  });

  it('clears the disconnect alert when the action is retried, then closes with no alert on success', async () => {
    const second = deferred<void>();
    mocks.user = googleUser;
    mocks.disconnectGoogle
      .mockRejectedValueOnce(new Error('boom'))
      .mockReturnValueOnce(second.promise);
    render(<NameEditForm />);
    const user = userEvent.setup();
    const dialog = await openDisconnectDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await within(dialog).findByRole('alert');

    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Disconnecting...' })).toBeDisabled();

    second.resolve();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the disconnect alert when the dialog is cancelled and reopened', async () => {
    mocks.user = googleUser;
    mocks.disconnectGoogle.mockRejectedValue(new Error('boom'));
    render(<NameEditForm />);
    const user = userEvent.setup();
    const dialog = await openDisconnectDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await within(dialog).findByRole('alert');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    const reopened = await openDisconnectDialog(user);
    expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument();
  });
});
