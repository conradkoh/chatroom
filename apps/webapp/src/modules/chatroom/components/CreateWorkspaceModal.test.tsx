import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateWorkspaceModal } from './CreateWorkspaceModal';

import { renderWithUser, screen } from '@/test-utils';

const { mockUseSessionQuery, mockUseSessionMutation } = vi.hoisted(() => ({
  mockUseSessionQuery: vi.fn(),
  mockUseSessionMutation: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
  useSessionMutation: (...args: unknown[]) => mockUseSessionMutation(...args),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machines: { listMachines: 'machines:listMachines' },
    workspaces: { createWorkspace: 'workspaces:createWorkspace' },
  },
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock('@/components/ui/chatroom-loader', () => ({
  ChatroomLoader: () => <div data-testid="chatroom-loader" />,
}));

vi.mock('./setup/useSetupWorkspaceFolderPicker', () => ({
  useSetupWorkspaceFolderPicker: () => ({
    requestId: null,
    isPending: false,
    isTimedOut: false,
    handleBrowse: vi.fn(),
    handleRetryAfterTimeout: vi.fn(),
    reset: vi.fn(),
    machineDisplayName: null,
  }),
}));

const machineFixture = {
  machineId: 'machine-a',
  hostname: 'host-a',
  alias: 'Dev-Box',
  os: 'linux',
  availableHarnesses: ['opencode'] as const,
  harnessVersions: {},
};

function renderModal(onOpenChange = vi.fn()) {
  return renderWithUser(<CreateWorkspaceModal open onOpenChange={onOpenChange} />);
}

describe('CreateWorkspaceModal', () => {
  const mockCreateWorkspace = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionQuery.mockReturnValue({ machines: [machineFixture] });
    mockUseSessionMutation.mockReturnValue(mockCreateWorkspace);
    mockCreateWorkspace.mockResolvedValue('workspace-1');
  });

  it('requires a machine selection before the path field is usable', async () => {
    const { user } = renderModal();

    const pathInput = screen.getByPlaceholderText('Select a machine first');
    expect(pathInput).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Dev-Box' }));

    const enabledInput = screen.getByPlaceholderText('Select a folder on Dev-Box');
    expect(enabledInput).toBeEnabled();
  });

  it('creates the workspace and closes on success', async () => {
    const onOpenChange = vi.fn();
    const { user } = renderModal(onOpenChange);

    await user.click(screen.getByRole('button', { name: 'Dev-Box' }));
    await user.type(screen.getByPlaceholderText('Select a folder on Dev-Box'), '/tmp/project');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(mockCreateWorkspace).toHaveBeenCalledWith({
      machineId: 'machine-a',
      workingDir: '/tmp/project',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders a structured CONFLICT inline without closing', async () => {
    const onOpenChange = vi.fn();
    mockCreateWorkspace.mockRejectedValue(
      new ConvexError({
        code: 'CONFLICT',
        message: 'A workspace already exists on this machine for that folder',
        fields: ['machineId', 'workingDir'],
      })
    );
    const { user } = renderModal(onOpenChange);

    await user.click(screen.getByRole('button', { name: 'Dev-Box' }));
    await user.type(screen.getByPlaceholderText('Select a folder on Dev-Box'), '/tmp/project');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(
      screen.getByText('A workspace already exists on this machine for that folder')
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('shows a generic inline error for non-conflict failures', async () => {
    mockCreateWorkspace.mockRejectedValue(new Error('boom'));
    const { user } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Dev-Box' }));
    await user.type(screen.getByPlaceholderText('Select a folder on Dev-Box'), '/tmp/project');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('shows a loading state while machines load', () => {
    mockUseSessionQuery.mockReturnValue(undefined);
    renderModal();
    expect(screen.getByText('Loading machines...')).toBeInTheDocument();
  });

  it('shows an empty state when no machines are registered', () => {
    mockUseSessionQuery.mockReturnValue({ machines: [] });
    renderModal();
    expect(screen.getByText('No machines connected')).toBeInTheDocument();
  });

  it('submits with Enter when the form is valid', async () => {
    const onOpenChange = vi.fn();
    const { user } = renderModal(onOpenChange);

    await user.click(screen.getByRole('button', { name: 'Dev-Box' }));
    const input = screen.getByPlaceholderText('Select a folder on Dev-Box');
    await user.type(input, '/tmp/enter');
    await user.keyboard('{Enter}');

    expect(mockCreateWorkspace).toHaveBeenCalledWith({
      machineId: 'machine-a',
      workingDir: '/tmp/enter',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
