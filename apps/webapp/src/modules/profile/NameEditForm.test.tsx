import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NameEditForm } from './NameEditForm';

import { useAuthState, useCurrentUser } from '@/modules/auth/AuthProvider';
import type * as GoogleOAuthModule from '@/modules/auth/google-oauth';

const mocks = vi.hoisted(() => ({
  updateName: vi.fn(),
  createConnectRequest: vi.fn(),
  disconnectGoogle: vi.fn(),
  redirect: vi.fn(),
}));

// Data port: the Google config query.
vi.mock('convex/react', () => ({
  useQuery: () => ({ enabled: true, clientId: 'client-1' }),
}));

// Data port: the Convex mutations, keyed by their generated function names.
vi.mock('convex-helpers/react/sessions', async () => {
  const { getFunctionName } = await import('convex/server');
  return {
    useSessionMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === 'auth:updateUserName') return mocks.updateName;
      if (name === 'auth/google:createConnectRequest') return mocks.createConnectRequest;
      if (name === 'auth/google:disconnectGoogle') return mocks.disconnectGoogle;
      throw new Error(`Unexpected mutation in NameEditForm test: ${name}`);
    },
  };
});

// Data port: the signed-in user.
vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuthState: vi.fn(),
  useCurrentUser: vi.fn(),
}));

// Browser-navigation port: the redirect to Google. Everything else is real.
vi.mock('@/modules/auth/google-oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof GoogleOAuthModule>();
  return { ...actual, redirectToGoogleOAuth: mocks.redirect };
});

const aliceWithoutGoogle = {
  _id: 'u' as Id<'users'>,
  _creationTime: 0,
  type: 'anonymous' as const,
  name: 'Alice',
};

const aliceWithGoogle = {
  _id: 'u' as Id<'users'>,
  _creationTime: 0,
  type: 'full' as const,
  name: 'Alice',
  email: 'alice@example.com',
  google: { id: 'google-1', email: 'alice@gmail.com', name: 'Alice' },
};

let user: ReturnType<typeof userEvent.setup>;

function mockSignedIn(userDoc: typeof aliceWithoutGoogle | typeof aliceWithGoogle) {
  vi.mocked(useCurrentUser).mockReturnValue(userDoc);
  vi.mocked(useAuthState).mockReturnValue({
    sessionId: 'session-1',
    state: 'authenticated',
    user: userDoc,
    accessLevel: 'user',
    permissions: [],
  });
}

async function startEditing() {
  await user.click(screen.getByRole('button', { name: 'Edit Name' }));
  return screen.getByRole('textbox');
}

async function openDisconnectDialog() {
  await user.click(screen.getByRole('button', { name: /Connected/ }));
  await user.click(await screen.findByRole('menuitem', { name: /Disconnect/ }));
  return screen.findByRole('alertdialog');
}

describe('NameEditForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateName.mockResolvedValue({ success: true, message: 'Name updated successfully' });
    mocks.createConnectRequest.mockResolvedValue({ connectId: 'connect-1' });
    mocks.disconnectGoogle.mockResolvedValue(undefined);
    user = userEvent.setup();
  });

  it('name save closes the form and shows no success text', async () => {
    mockSignedIn(aliceWithoutGoogle);

    render(<NameEditForm />);
    const input = await startEditing();
    await user.clear(input);
    await user.type(input, 'Bob Smith');

    await user.click(screen.getByRole('button', { name: 'Save Name' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save Name' })).not.toBeInTheDocument()
    );
    expect(mocks.updateName).toHaveBeenCalledWith({ newName: 'Bob Smith' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a rejected name save shows the alert under the field and the next edit clears it', async () => {
    mocks.updateName.mockRejectedValueOnce(new Error('boom'));
    mockSignedIn(aliceWithoutGoogle);

    render(<NameEditForm />);
    const input = await startEditing();
    await user.type(input, 'Bob Smith');

    await user.click(screen.getByRole('button', { name: 'Save Name' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to update name. Please try again.'
    );

    await user.type(input, '!');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a name the backend rejects keeps the editor open and shows the reason under the field', async () => {
    mocks.updateName.mockResolvedValueOnce({
      success: false,
      reason: 'name_too_short',
      message: 'Name must be at least 3 characters long',
    });
    mockSignedIn(aliceWithoutGoogle);

    render(<NameEditForm />);
    const input = await startEditing();
    await user.clear(input);
    await user.type(input, 'Al');
    await user.click(screen.getByRole('button', { name: 'Save Name' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Name must be at least 3 characters long'
    );
    expect(screen.getByRole('button', { name: 'Save Name' })).toBeInTheDocument();

    await user.type(input, 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a rejected Google connect shows the alert in the account slot and the next attempt clears it', async () => {
    mocks.createConnectRequest.mockRejectedValueOnce(new Error('boom'));
    mockSignedIn(aliceWithoutGoogle);

    render(<NameEditForm />);
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    const slot = await screen.findByTestId('google-connect-feedback');
    expect(slot).toHaveAttribute('role', 'alert');
    expect(slot).toHaveTextContent('Failed to connect Google account');

    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });

  it('a successful Google connect shows no message', async () => {
    mockSignedIn(aliceWithoutGoogle);

    render(<NameEditForm />);
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(mocks.redirect).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Dismiss clears the connect failure', async () => {
    mocks.createConnectRequest.mockRejectedValueOnce(new Error('boom'));
    mockSignedIn(aliceWithoutGoogle);

    render(<NameEditForm />);
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    const slot = await screen.findByTestId('google-connect-feedback');
    await user.click(within(slot).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('google-connect-feedback')).not.toBeInTheDocument();
  });

  it('a successful Google disconnect closes the dialog with no message', async () => {
    mockSignedIn(aliceWithGoogle);

    render(<NameEditForm />);
    const dialog = await openDisconnectDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a rejected Google disconnect keeps the dialog open with the alert inside it, and the next attempt clears it', async () => {
    mocks.disconnectGoogle.mockRejectedValueOnce(new Error('boom'));
    mockSignedIn(aliceWithGoogle);

    render(<NameEditForm />);
    const dialog = await openDisconnectDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    const openDialog = await screen.findByRole('alertdialog');
    expect(within(openDialog).getByRole('alert')).toHaveTextContent(
      'Failed to disconnect Google account'
    );
    const retry = within(openDialog).getByRole('button', { name: 'Disconnect' });
    expect(retry).toBeEnabled();

    await user.click(retry);

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
