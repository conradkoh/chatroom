import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { WorkspaceFileMenuItems } from './WorkspaceFileMenuItems';
import type { WorkspaceFileMenuProps } from './types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const writeText = vi.fn();

const defaultState = {
  relativePath: 'src/foo.ts',
  workingDir: '/workspace/project',
  content: 'file body',
};

const defaultHandlers = {
  onOpenInExplorer: vi.fn(),
  onOpenFileOnRemote: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onCloseOthers: vi.fn(),
  onNewFile: vi.fn(),
  onNewFolder: vi.fn(),
};

const defaultVisibility: WorkspaceFileMenuProps['visibility'] = {
  copyFileName: true,
  copyRelativePath: true,
  copyFullPath: true,
  copyFileContent: true,
  openInExplorer: true,
  openFileOnRemote: true,
  rename: true,
  delete: true,
  closeOthers: true,
  newFile: true,
  newFolder: true,
};

function renderMenu(overrides: Partial<WorkspaceFileMenuProps> = {}) {
  return render(
    <DropdownMenu open={true} onOpenChange={vi.fn()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <WorkspaceFileMenuItems
          state={{ ...defaultState, ...overrides.state }}
          handlers={{ ...defaultHandlers, ...overrides.handlers }}
          visibility={{ ...defaultVisibility, ...overrides.visibility }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe('WorkspaceFileMenuItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('renders all sections with visible items', () => {
    renderMenu();
    expect(screen.getByText('New File')).toBeInTheDocument();
    expect(screen.getByText('New Folder')).toBeInTheDocument();
    expect(screen.getByText('Path')).toBeInTheDocument();
    expect(screen.getByText('Copy File Name')).toBeInTheDocument();
    expect(screen.getByText('Copy Relative Path')).toBeInTheDocument();
    expect(screen.getByText('Copy Full Path')).toBeInTheDocument();
    expect(screen.getByText('Open in Explorer')).toBeInTheDocument();
    expect(screen.getByText('Open File on Remote')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByText('Copy File Content')).toBeInTheDocument();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Close Others')).toBeInTheDocument();
  });

  it('omits sections with no visible items', () => {
    renderMenu({
      visibility: {
        copyFileName: true,
        copyRelativePath: true,
        copyFullPath: true,
        copyFileContent: false,
        openInExplorer: false,
        openFileOnRemote: false,
        rename: false,
        delete: false,
        closeOthers: false,
        newFile: false,
        newFolder: false,
      },
    });
    expect(screen.queryByText('New File')).not.toBeInTheDocument();
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Rename')).not.toBeInTheDocument();
    expect(screen.queryByText('Close Others')).not.toBeInTheDocument();
    expect(screen.getByText('Path')).toBeInTheDocument();
    expect(screen.getByText('Copy File Name')).toBeInTheDocument();
  });

  it('renders custom file content label', () => {
    renderMenu({
      state: { ...defaultState, fileContentLabel: 'Copy as Markdown' },
    });
    expect(screen.getByText('Copy as Markdown')).toBeInTheDocument();
  });
});
