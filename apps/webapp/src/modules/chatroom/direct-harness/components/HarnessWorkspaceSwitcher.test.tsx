import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { HarnessWorkspaceSwitcher } from './HarnessWorkspaceSwitcher';

// jsdom does not provide matchMedia (used by vaul drawer and useIsDesktop)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const mockUseIsDesktop = vi.fn(() => true);

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

// ─── Fixture ──────────────────────────────────────────────────────────────────

const ws = (id: string, alias: string, dir: string) => ({
  _id: id as never,
  machineId: 'm-' + id,
  workingDir: dir,
  hostname: 'host-' + id,
  machineAlias: alias,
  registeredAt: 0,
  registeredBy: 'u',
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HarnessWorkspaceSwitcher', () => {
  it('renders the empty-state pill when workspaces is empty', () => {
    render(
      <HarnessWorkspaceSwitcher workspaces={[]} selectedWorkspaceId={null} onSelect={vi.fn()} />
    );
    expect(screen.getByText(/no workspaces in this chatroom/i)).toBeInTheDocument();
  });

  it('renders the trigger with the selected workspace display label', () => {
    const workspaces = [ws('ws1', 'My Machine', '/home/user/project')];
    render(
      <HarnessWorkspaceSwitcher
        workspaces={workspaces}
        selectedWorkspaceId={'ws1' as never}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText('My Machine — project')).toBeInTheDocument();
  });

  it('calls onSelect with the correct id when an option is chosen', () => {
    mockUseIsDesktop.mockReturnValue(true);
    const workspaces = [
      ws('ws1', 'Machine A', '/home/user/project-a'),
      ws('ws2', 'Machine B', '/home/user/project-b'),
    ];
    const onSelect = vi.fn();
    render(
      <HarnessWorkspaceSwitcher
        workspaces={workspaces}
        selectedWorkspaceId={'ws1' as never}
        onSelect={onSelect}
      />
    );

    const trigger = screen.getByTitle('Select workspace');
    fireEvent.click(trigger);

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);

    fireEvent.click(options[1]);
    expect(onSelect).toHaveBeenCalledWith('ws2');
  });

  it('renders drawer content on mobile viewport', () => {
    mockUseIsDesktop.mockReturnValue(false);
    const workspaces = [ws('ws1', 'Machine A', '/home/user/project-a')];
    render(
      <HarnessWorkspaceSwitcher
        workspaces={workspaces}
        selectedWorkspaceId={'ws1' as never}
        onSelect={vi.fn()}
      />
    );

    const trigger = screen.getByTitle('Select workspace');
    fireEvent.click(trigger);

    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
  });
});
