import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCommandPaletteCommands } from './useCommandPaletteCommands';

import { fuzzyFilter } from '@/lib/fuzzyMatch';

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
      label: 'Chatroom: New Chatroom',
      keywords: ['new', 'create', 'chatroom'],
    });

    newChatroomCommand?.action();
    expect(onCreateNewChatroom).toHaveBeenCalledTimes(1);
  });

  it('omits the New Chatroom command when no callback is provided', () => {
    const { result } = renderHook(() => useCommandPaletteCommands(baseProps));

    expect(result.current.some((command) => command.id === 'nav-new-chatroom')).toBe(false);
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
        label: 'Chatroom: Stop all remote agents',
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
        label: 'Chatroom: Start all remote agents',
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

  describe('Chatroom: Refresh Workspace State command', () => {
    it('adds command when handler is provided', () => {
      const onRefreshWorkspaceState = vi.fn();

      const { result } = renderHook(() =>
        useCommandPaletteCommands({ ...baseProps, onRefreshWorkspaceState })
      );

      const cmd = result.current.find((c) => c.id === 'workspace.refreshState');
      expect(cmd).toBeDefined();
      expect(cmd).toMatchObject({
        label: 'Chatroom: Refresh Workspace State',
        keywords: expect.arrayContaining(['refresh', 'workspace', 'sync']),
      });
      expect(cmd?.keywords).toBeDefined();
      expect(cmd?.keywords?.some((k) => k.toLowerCase() === 'pull')).toBe(false);
      expect(
        fuzzyFilter('Chatroom: Refresh Workspace State', 'pull', cmd?.keywords)
      ).toBe(0);
    });

    it('triggers the handler when the action is called', () => {
      const onRefreshWorkspaceState = vi.fn();

      const { result } = renderHook(() =>
        useCommandPaletteCommands({ ...baseProps, onRefreshWorkspaceState })
      );

      const cmd = result.current.find((c) => c.id === 'workspace.refreshState');
      cmd?.action();
      expect(onRefreshWorkspaceState).toHaveBeenCalledTimes(1);
    });

    it('omits command when handler is not provided', () => {
      const { result } = renderHook(() => useCommandPaletteCommands({ ...baseProps }));
      expect(result.current.some((c) => c.id === 'workspace.refreshState')).toBe(false);
    });
  });
});
