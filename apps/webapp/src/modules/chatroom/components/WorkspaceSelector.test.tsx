import { describe, expect, it, vi } from 'vitest';

import { WorkspaceSelector, getWorkspacePathName } from './WorkspaceSelector';

import { renderWithUser, screen } from '@/test-utils';

const { mockUseAllWorkspaces } = vi.hoisted(() => ({
  mockUseAllWorkspaces: vi.fn(),
}));

vi.mock('@/modules/chatroom/workspace/hooks/useAllWorkspaces', () => ({
  useAllWorkspaces: () => mockUseAllWorkspaces(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaces: {
      listAllWorkspaces: 'workspaces:listAllWorkspaces',
    },
  },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => undefined,
}));

const workspacesFixture = [
  {
    _id: 'ws1',
    chatroomId: 'chat1',
    chatroomName: 'Alpha Team',
    machineId: 'machine-a',
    workingDir: '/tmp/project-a',
    hostname: 'host-a',
    machineAlias: 'Dev-Box',
    registeredAt: 1750000000000,
    registeredBy: 'builder',
  },
  {
    _id: 'ws2',
    chatroomId: 'chat2',
    chatroomName: 'Beta Team',
    machineId: 'machine-b',
    workingDir: '/tmp/project-b',
    hostname: 'host-b',
    registeredAt: 1750000000000,
    registeredBy: 'planner',
  },
];

describe('getWorkspacePathName', () => {
  it.each([
    ['/tmp/project-a', 'project-a'],
    ['/tmp/project-a/', 'project-a'],
    ['C:\\Users\\dev', 'dev'],
    ['/', '/'],
    ['', ''],
    ['project-a', 'project-a'],
  ])('%s -> %s', (input, expected) => {
    expect(getWorkspacePathName(input)).toBe(expected);
  });
});

describe('WorkspaceSelector', () => {
  it('shows loading state while loading', () => {
    mockUseAllWorkspaces.mockReturnValue({ workspaces: [], isLoading: true });
    renderWithUser(<WorkspaceSelector onSelectChatroom={() => {}} />);
    expect(screen.getByText('Loading workspaces...')).toBeInTheDocument();
  });

  it('shows empty state when no workspaces are registered', () => {
    mockUseAllWorkspaces.mockReturnValue({ workspaces: [], isLoading: false });
    renderWithUser(<WorkspaceSelector onSelectChatroom={() => {}} />);
    expect(screen.getByText('No workspaces registered yet')).toBeInTheDocument();
  });

  it('renders workspace cards with path-name title, machine tag, and chatroom name', () => {
    mockUseAllWorkspaces.mockReturnValue({ workspaces: workspacesFixture, isLoading: false });
    renderWithUser(<WorkspaceSelector onSelectChatroom={() => {}} />);

    expect(screen.getByText('project-a')).toBeInTheDocument();
    expect(screen.getByText('project-b')).toBeInTheDocument();

    expect(screen.getByText('Dev-Box')).toBeInTheDocument();
    expect(screen.getByText('host-b')).toBeInTheDocument();

    expect(screen.getByText('/tmp/project-a')).toBeInTheDocument();
    expect(screen.getByText('/tmp/project-b')).toBeInTheDocument();

    expect(screen.getByText('Alpha Team')).toBeInTheDocument();
    expect(screen.getByText('Beta Team')).toBeInTheDocument();
  });

  it('filters workspaces by search query', async () => {
    mockUseAllWorkspaces.mockReturnValue({ workspaces: workspacesFixture, isLoading: false });
    const { user } = renderWithUser(<WorkspaceSelector onSelectChatroom={() => {}} />);

    await user.type(screen.getByPlaceholderText('Search workspaces...'), 'Dev-Box');

    expect(screen.getByText('Dev-Box')).toBeInTheDocument();
    expect(screen.queryByText('/tmp/project-b')).not.toBeInTheDocument();
  });

  it('calls onSelectChatroom when a workspace card is clicked', async () => {
    mockUseAllWorkspaces.mockReturnValue({ workspaces: workspacesFixture, isLoading: false });
    const onSelectChatroom = vi.fn();
    const { user } = renderWithUser(<WorkspaceSelector onSelectChatroom={onSelectChatroom} />);

    await user.click(screen.getByText('/tmp/project-a'));

    expect(onSelectChatroom).toHaveBeenCalledWith('chat1');
  });
});
