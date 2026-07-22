import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatroomTitleEditor } from './ChatroomTitleEditor';

vi.mock('@/lib/environment', () => ({
  getLocalManagerUrl: vi.fn(),
}));

import { getLocalManagerUrl } from '@/lib/environment';

const mockedGetLocalManagerUrl = vi.mocked(getLocalManagerUrl);

vi.mock('./useChatroomTitleEditor', () => ({
  useChatroomTitleEditor: () => ({
    isEditing: false,
    editedName: '',
    setEditedName: vi.fn(),
    isPending: false,
    handleStartEdit: vi.fn(),
    handleCancel: vi.fn(),
    handleSave: vi.fn(),
  }),
}));

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Chatroom:.*Open menu/i }));
  return user;
}

describe('ChatroomTitleEditor menu', () => {
  const base = {
    displayName: 'Demo Room',
    chatroomId: 'room1',
    chatStatus: 'active' as const,
    onOpenSettings: vi.fn(),
    onSwitchChatrooms: vi.fn(),
    onOpenProfile: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetLocalManagerUrl.mockReturnValue(null);
  });

  it('shows shared items and calls switcher + profile', async () => {
    render(<ChatroomTitleEditor {...base} isDesktop />);
    const user = await openMenu();
    expect(screen.getByText('Edit Name')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    await user.click(screen.getByText('Switch Chatrooms'));
    expect(base.onSwitchChatrooms).toHaveBeenCalled();

    await openMenu();
    await user.click(screen.getByText('User Profile'));
    expect(base.onOpenProfile).toHaveBeenCalled();
  });

  it('desktop: shows Enable Focus Mode when inactive', async () => {
    const onEnableFocusMode = vi.fn();
    render(
      <ChatroomTitleEditor
        {...base}
        isDesktop
        focusModeActive={false}
        onEnableFocusMode={onEnableFocusMode}
        onDisableFocusMode={vi.fn()}
      />
    );
    const user = await openMenu();
    expect(screen.queryByText('Show Agent Sidebar')).not.toBeInTheDocument();
    await user.click(screen.getByText('Enable Focus Mode'));
    expect(onEnableFocusMode).toHaveBeenCalled();
  });

  it('desktop: shows Disable Focus Mode when active', async () => {
    const onDisableFocusMode = vi.fn();
    render(
      <ChatroomTitleEditor
        {...base}
        isDesktop
        focusModeActive
        onEnableFocusMode={vi.fn()}
        onDisableFocusMode={onDisableFocusMode}
      />
    );
    const user = await openMenu();
    await user.click(screen.getByText('Disable Focus Mode'));
    expect(onDisableFocusMode).toHaveBeenCalled();
  });

  it('mobile: shows Show Agent Sidebar and hides focus mode', async () => {
    const onShowAgentsSidebar = vi.fn();
    render(
      <ChatroomTitleEditor
        {...base}
        isDesktop={false}
        onShowAgentsSidebar={onShowAgentsSidebar}
        onEnableFocusMode={vi.fn()}
        onDisableFocusMode={vi.fn()}
      />
    );
    const user = await openMenu();
    expect(screen.queryByText('Enable Focus Mode')).not.toBeInTheDocument();
    expect(screen.queryByText('Disable Focus Mode')).not.toBeInTheDocument();
    await user.click(screen.getByText('Show Agent Sidebar'));
    expect(onShowAgentsSidebar).toHaveBeenCalled();
  });

  it('does not show Back to chatroom list', async () => {
    render(<ChatroomTitleEditor {...base} isDesktop />);
    await openMenu();
    expect(screen.queryByText('Back to chatroom list')).not.toBeInTheDocument();
  });

  it('renders chat status indicator left of title', () => {
    render(<ChatroomTitleEditor {...base} chatStatus="working" isDesktop />);
    expect(screen.getByLabelText('Agents are working on tasks')).toBeInTheDocument();
    expect(screen.getByText('Demo Room')).toBeInTheDocument();
  });

  it('desktop: focus mode toggle enables focus mode without opening menu', async () => {
    const onEnableFocusMode = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatroomTitleEditor
        {...base}
        isDesktop
        focusModeActive={false}
        onEnableFocusMode={onEnableFocusMode}
        onDisableFocusMode={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Enable focus mode' }));
    expect(onEnableFocusMode).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Edit Name')).not.toBeInTheDocument();
  });

  it('desktop: focus mode toggle disables focus mode when active', async () => {
    const onDisableFocusMode = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatroomTitleEditor
        {...base}
        isDesktop
        focusModeActive
        onEnableFocusMode={vi.fn()}
        onDisableFocusMode={onDisableFocusMode}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Disable focus mode' }));
    expect(onDisableFocusMode).toHaveBeenCalledTimes(1);
  });

  it('mobile: hides focus mode toggle', () => {
    render(
      <ChatroomTitleEditor
        {...base}
        isDesktop={false}
        onEnableFocusMode={vi.fn()}
        onDisableFocusMode={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /focus mode/i })).not.toBeInTheDocument();
  });

  it('hides Chatroom Local Manager when getLocalManagerUrl returns null', async () => {
    mockedGetLocalManagerUrl.mockReturnValue(null);
    render(<ChatroomTitleEditor {...base} isDesktop />);
    await openMenu();
    expect(screen.queryByText('Chatroom Local Manager')).not.toBeInTheDocument();
  });

  it('shows Chatroom Local Manager when getLocalManagerUrl returns a URL', async () => {
    mockedGetLocalManagerUrl.mockReturnValue('http://localhost:3847');
    render(<ChatroomTitleEditor {...base} isDesktop />);
    await openMenu();
    expect(screen.getByText('Chatroom Local Manager')).toBeInTheDocument();
  });
});
