import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCommandPaletteCommands } from './useCommandPaletteCommands';

import { fuzzyFilter } from '@/lib/fuzzyMatch';

vi.mock('../../lib/commandFavoritesStore', () => ({
  getCommandFavoritesStore: () => ({
    getAll: () => new Set(['dev']),
  }),
}));

describe('useCommandPaletteCommands', () => {
  const baseProps = {
    onOpenSettings: vi.fn(),
    onOpenEventStream: vi.fn(),
    onOpenGitPanel: vi.fn(),
    onOpenBacklog: vi.fn(),
    onOpenPendingReview: vi.fn(),
    onOpenChatroomSwitcher: vi.fn(),
    onOpenFileSelector: vi.fn(),
  };

  it('adds a New Chatroom navigation command when a callback is provided', () => {
    const onCreateNewChatroom = vi.fn();

    const { result } = renderHook(() =>
      useCommandPaletteCommands({
        ...baseProps,
        onCreateNewChatroom,
      })
    );

    const navigateCommands = result.current.filter((command) => command.category === 'Navigate');

    expect(navigateCommands.map((command) => command.id)).toEqual([
      'nav-switch-chatroom',
      'nav-new-chatroom',
      'nav-go-to-file',
    ]);

    const newChatroomCommand = navigateCommands.find(
      (command) => command.id === 'nav-new-chatroom'
    );
    expect(newChatroomCommand).toMatchObject({
      label: 'New Chatroom',
      keywords: ['new', 'create', 'chatroom', 'new chatroom'],
    });

    newChatroomCommand?.action();
    expect(onCreateNewChatroom).toHaveBeenCalledTimes(1);
  });

  it('matches "New Chatroom" search query via keywords', () => {
    const onCreateNewChatroom = vi.fn();

    const { result } = renderHook(() =>
      useCommandPaletteCommands({
        ...baseProps,
        onCreateNewChatroom,
      })
    );

    const newChatroomCommand = result.current.find((command) => command.id === 'nav-new-chatroom');

    expect(newChatroomCommand).toBeDefined();
    expect(
      fuzzyFilter('New Chatroom', 'New Chatroom', newChatroomCommand?.keywords)
    ).toBeGreaterThan(0);
  });

  it('omits the New Chatroom command when no callback is provided', () => {
    const { result } = renderHook(() => useCommandPaletteCommands(baseProps));

    expect(result.current.some((command) => command.id === 'nav-new-chatroom')).toBe(false);
  });

  it('adds New Backlog Item command when callback is provided', () => {
    const onCreateBacklogItem = vi.fn();

    const { result } = renderHook(() =>
      useCommandPaletteCommands({
        ...baseProps,
        onCreateBacklogItem,
      })
    );

    const command = result.current.find((command) => command.id === 'action-new-backlog-item');
    expect(command).toMatchObject({
      label: 'New Backlog Item',
      category: 'Actions',
      keywords: expect.arrayContaining(['create', 'backlog', 'new']),
    });

    command?.action();
    expect(onCreateBacklogItem).toHaveBeenCalledTimes(1);
  });

  it('matches "create" search query for New Backlog Item via keywords', () => {
    const onCreateBacklogItem = vi.fn();

    const { result } = renderHook(() =>
      useCommandPaletteCommands({
        ...baseProps,
        onCreateBacklogItem,
      })
    );

    const command = result.current.find((command) => command.id === 'action-new-backlog-item');
    expect(command).toBeDefined();
    expect(command?.keywords).toContain('create');
  });

  describe('Stop All Remote Agents command', () => {
    it('adds Stop All Remote Agents command when handler is provided', () => {
      const onStopAllRemoteAgents = vi.fn();

      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          onStopAllRemoteAgents,
        })
      );

      const agentsCommands = result.current.filter((command) => command.category === 'Agents');
      const stopCommand = agentsCommands.find((command) => command.id === 'agents-stop-all-remote');

      expect(stopCommand).toBeDefined();
      expect(stopCommand).toMatchObject({
        label: 'Agents: Stop All Remote',
        keywords: ['stop', 'remote', 'kill', 'terminate', 'all'],
      });
    });

    it('triggers the handler when Stop All Remote Agents action is called', () => {
      const onStopAllRemoteAgents = vi.fn();

      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          onStopAllRemoteAgents,
        })
      );

      const stopCommand = result.current.find((command) => command.id === 'agents-stop-all-remote');
      stopCommand?.action();

      expect(onStopAllRemoteAgents).toHaveBeenCalledTimes(1);
    });

    it('omits Stop All Remote Agents command when handler is null (during operation)', () => {
      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          onStopAllRemoteAgents: null,
        })
      );

      expect(result.current.some((command) => command.id === 'agents-stop-all-remote')).toBe(false);
    });

    it('omits Stop All Remote Agents command when handler is undefined', () => {
      const { result } = renderHook(() => useCommandPaletteCommands(baseProps));

      expect(result.current.some((command) => command.id === 'agents-stop-all-remote')).toBe(false);
    });
  });

  describe('panel-git-diff dedup (Bug #5/#14)', () => {
    it('does not register a global panel-git-diff command in legacy (no workspaceCommands) mode', () => {
      const { result } = renderHook(() => useCommandPaletteCommands(baseProps));

      expect(result.current.some((cmd) => cmd.id === 'panel-git-diff')).toBe(false);
    });

    it('does not register a global panel-git-diff command in multi-workspace mode', () => {
      const workspaceCommands = [
        {
          id: 'ws-abc-git-diff',
          label: 'Git: Show Current Changes',
          category: 'Actions' as const,
          action: vi.fn(),
        },
      ];

      const { result } = renderHook(() =>
        useCommandPaletteCommands({ ...baseProps, workspaceCommands })
      );

      expect(result.current.some((cmd) => cmd.id === 'panel-git-diff')).toBe(false);
    });

    it('keeps a single Git: Show Current Changes when workspaceCommands provide one', () => {
      const workspaceCommands = [
        {
          id: 'ws-abc-git-diff',
          label: 'Git: Show Current Changes',
          category: 'Actions' as const,
          action: vi.fn(),
        },
      ];

      const { result } = renderHook(() =>
        useCommandPaletteCommands({ ...baseProps, workspaceCommands })
      );

      const gitDiffCmds = result.current.filter((cmd) => cmd.label === 'Git: Show Current Changes');
      expect(gitDiffCmds).toHaveLength(1);
    });

    it('still exposes the parent Git Panel entry (panel-git) so users can reach git in legacy mode', () => {
      const { result } = renderHook(() =>
        useCommandPaletteCommands({ ...baseProps, workspaceCommands: [] })
      );
      expect(result.current.some((cmd) => cmd.id === 'panel-git')).toBe(true);
    });
  });

  describe('Start All Remote Agents command', () => {
    it('adds Start All Remote Agents command when handler is provided', () => {
      const onStartAllRemoteAgents = vi.fn();

      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          onStartAllRemoteAgents,
        })
      );

      const agentsCommands = result.current.filter((command) => command.category === 'Agents');
      const startCommand = agentsCommands.find(
        (command) => command.id === 'agents-start-all-remote'
      );

      expect(startCommand).toBeDefined();
      expect(startCommand).toMatchObject({
        label: 'Agents: Start All Remote',
        keywords: ['start', 'remote', 'run', 'launch', 'all'],
      });
    });

    it('triggers the handler when Start All Remote Agents action is called', () => {
      const onStartAllRemoteAgents = vi.fn();

      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          onStartAllRemoteAgents,
        })
      );

      const startCommand = result.current.find(
        (command) => command.id === 'agents-start-all-remote'
      );
      startCommand?.action();

      expect(onStartAllRemoteAgents).toHaveBeenCalledTimes(1);
    });

    it('omits Start All Remote Agents command when handler is null (during operation)', () => {
      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          onStartAllRemoteAgents: null,
        })
      );

      expect(result.current.some((command) => command.id === 'agents-start-all-remote')).toBe(
        false
      );
    });
  });

  describe('favorited runnable commands', () => {
    it('registers favorites with showOutputInline and script for streaming output modal', () => {
      const runnableCommands = [{ name: 'dev', script: 'pnpm dev', source: 'package.json' }];

      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          runnableCommands,
        })
      );

      const fav = result.current.find((c) => c.id === 'fav-dev');
      expect(fav).toBeDefined();
      expect(fav).toMatchObject({
        label: 'dev',
        showOutputInline: true,
        script: 'pnpm dev',
      });
    });
  });

  describe('Create Command actions', () => {
    it('adds Chatroom: Create Command and User: Create Command when onCreateCommand is provided', () => {
      const onCreateCommand = vi.fn();

      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          onCreateCommand,
        })
      );

      const createChatroomCmd = result.current.find(
        (c) => c.id === 'action-create-chatroom-command'
      );
      const createUserCmd = result.current.find((c) => c.id === 'action-create-user-command');

      expect(createChatroomCmd).toBeDefined();
      expect(createChatroomCmd).toMatchObject({
        label: 'Chatroom: Create Command',
        keywords: expect.arrayContaining(['chatroom', 'local']),
      });

      expect(createUserCmd).toBeDefined();
      expect(createUserCmd).toMatchObject({
        label: 'User: Create Command',
        keywords: expect.arrayContaining(['user', 'global', 'personal']),
      });
    });

    it('Chatroom: Create Command calls onCreateCommand("chatroom")', () => {
      const onCreateCommand = vi.fn();

      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          onCreateCommand,
        })
      );

      const cmd = result.current.find((c) => c.id === 'action-create-chatroom-command');
      cmd?.action();
      expect(onCreateCommand).toHaveBeenCalledWith('chatroom');
    });

    it('User: Create Command calls onCreateCommand("user")', () => {
      const onCreateCommand = vi.fn();

      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          onCreateCommand,
        })
      );

      const cmd = result.current.find((c) => c.id === 'action-create-user-command');
      cmd?.action();
      expect(onCreateCommand).toHaveBeenCalledWith('user');
    });

    it('omits create commands when onCreateCommand is not provided', () => {
      const { result } = renderHook(() => useCommandPaletteCommands(baseProps));

      expect(result.current.some((c) => c.id === 'action-create-chatroom-command')).toBe(false);
      expect(result.current.some((c) => c.id === 'action-create-user-command')).toBe(false);
    });
  });

  describe('Saved command palette labels', () => {
    it('includes scope suffix in saved command labels', () => {
      const savedCommands = [
        {
          _id: 'cmd-1' as any,
          type: 'prompt' as const,
          scope: 'user' as const,
          name: 'My Global',
          prompt: 'hello',
        },
        {
          _id: 'cmd-2' as any,
          type: 'prompt' as const,
          scope: 'chatroom' as const,
          name: 'My Local',
          prompt: 'world',
        },
      ];

      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          savedCommands,
          onExecuteSavedCommand: vi.fn(),
        })
      );

      const cmd1 = result.current.find((c) => c.id === 'saved-cmd-cmd-1');
      const cmd2 = result.current.find((c) => c.id === 'saved-cmd-cmd-2');

      expect(cmd1?.label).toBe('Command: My Global (User)');
      expect(cmd2?.label).toBe('Command: My Local (Chatroom)');
    });

    it('includes scope keywords in saved command entries', () => {
      const savedCommands = [
        {
          _id: 'cmd-user' as any,
          type: 'prompt' as const,
          scope: 'user' as const,
          name: 'Global Cmd',
          prompt: 'hello',
        },
      ];

      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          savedCommands,
          onExecuteSavedCommand: vi.fn(),
        })
      );

      const cmd = result.current.find((c) => c.id === 'saved-cmd-cmd-user');
      expect(cmd?.keywords).toEqual(
        expect.arrayContaining(['user', 'global', 'personal', 'all chatrooms'])
      );
    });

    it('adds saved commands when callbacks are provided', () => {
      const savedCommands = [
        {
          _id: 'cmd-abc' as any,
          type: 'prompt' as const,
          scope: 'chatroom' as const,
          name: 'Test Cmd',
          prompt: 'hello',
        },
      ];

      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          savedCommands,
          onExecuteSavedCommand: vi.fn(),
          onEditSavedCommand: vi.fn(),
          onDeleteSavedCommand: vi.fn(),
        })
      );

      const cmd = result.current.find((c) => c.id === 'saved-cmd-cmd-abc');
      expect(cmd).toBeDefined();
      expect(cmd?.secondaryActions).toHaveLength(2);
    });
  });

  describe('Chatroom: Refresh Workspace State command', () => {
    it('adds command when handler is provided', () => {
      const onRefreshWorkspaceState = vi.fn();

      const { result } = renderHook(() =>
        useCommandPaletteCommands({ ...baseProps, onRefreshWorkspaceState })
      );

      const cmd = result.current.find((c) => c.id === 'action-refresh-workspace-state');
      expect(cmd).toBeDefined();
      expect(cmd).toMatchObject({
        label: 'Chatroom: Refresh Workspace State',
        keywords: expect.arrayContaining(['refresh', 'workspace', 'sync']),
      });
      expect(cmd?.keywords).toBeDefined();
      expect(cmd?.keywords?.some((k) => k.toLowerCase() === 'pull')).toBe(false);
      expect(fuzzyFilter('Chatroom: Refresh Workspace State', 'pull', cmd?.keywords)).toBe(0);
    });

    it('triggers the handler when the action is called', () => {
      const onRefreshWorkspaceState = vi.fn();

      const { result } = renderHook(() =>
        useCommandPaletteCommands({ ...baseProps, onRefreshWorkspaceState })
      );

      const cmd = result.current.find((c) => c.id === 'action-refresh-workspace-state');
      cmd?.action();
      expect(onRefreshWorkspaceState).toHaveBeenCalledTimes(1);
    });

    it('omits command when handler is not provided', () => {
      const { result } = renderHook(() => useCommandPaletteCommands({ ...baseProps }));
      expect(result.current.some((c) => c.id === 'action-refresh-workspace-state')).toBe(false);
    });
  });

  describe('Agentic Search command', () => {
    it('adds agentic search command when callback is provided', () => {
      const { result } = renderHook(() =>
        useCommandPaletteCommands({
          ...baseProps,
          onOpenAgenticSearch: vi.fn(),
        })
      );
      const searchCmd = result.current.find((c) => c.id === 'nav-agentic-search');
      expect(searchCmd).toBeDefined();
      expect(searchCmd?.shortcut).toBe('⌘⇧F');
    });

    it('omits agentic search command when callback is not provided', () => {
      const { result } = renderHook(() => useCommandPaletteCommands({ ...baseProps }));
      expect(result.current.some((c) => c.id === 'nav-agentic-search')).toBe(false);
    });
  });
});
