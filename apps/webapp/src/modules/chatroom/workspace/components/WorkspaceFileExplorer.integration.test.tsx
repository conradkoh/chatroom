import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceFileExplorer } from './WorkspaceFileExplorer';

const listingMocks = vi.hoisted(() => {
  const rootEntries = [
    { name: 'src', path: 'src', type: 'directory' as const },
    { name: 'package.json', path: 'package.json', type: 'file' as const },
  ];
  const srcChildEntries = [{ name: 'index.ts', path: 'src/index.ts', type: 'file' as const }];
  const searchRefresh = vi.fn();

  const rootListing = {
    get entries() {
      return rootEntries;
    },
    isLoading: false,
    refresh: vi.fn(),
    scannedAt: 1,
    truncated: false,
  };

  const searchListing = {
    entries: [] as never[],
    isLoading: false,
    refresh: searchRefresh,
  };

  return {
    rootEntries,
    srcChildEntries,
    rootLoading: false,
    childStates: new Map<string, { entries: typeof srcChildEntries; isLoading: boolean }>(),
    rootListing,
    searchListing,
    get rootRefresh() {
      return rootListing.refresh;
    },
    childRefresh: vi.fn(),
  };
});

const STABLE_EMPTY: never[] = [];

vi.mock('@/modules/chatroom/workspace/files/useDirListing', () => ({
  useDirListing: (args: { dirPath: string } | 'skip') => {
    if (args === 'skip') {
      return {
        entries: STABLE_EMPTY,
        isLoading: false,
        refresh: vi.fn(),
        scannedAt: null,
        truncated: false,
      };
    }

    if (args.dirPath === '') {
      listingMocks.rootListing.isLoading = listingMocks.rootLoading;
      return listingMocks.rootListing;
    }

    const childState = listingMocks.childStates.get(args.dirPath) ?? {
      entries: STABLE_EMPTY,
      isLoading: true,
    };

    return {
      entries: childState.entries,
      isLoading: childState.isLoading,
      refresh: listingMocks.childRefresh,
      scannedAt: null,
      truncated: false,
    };
  },
}));

vi.mock('@/modules/chatroom/workspace/files/useFileSearch', () => ({
  useFileSearch: () => listingMocks.searchListing,
}));

const defaultProps = {
  machineId: 'machine-1',
  workingDir: '/workspace',
  selectedPath: null as string | null,
};

beforeEach(() => {
  localStorage.clear();
  listingMocks.rootEntries.length = 0;
  listingMocks.rootEntries.push(
    { name: 'src', path: 'src', type: 'directory' as const },
    { name: 'package.json', path: 'package.json', type: 'file' as const }
  );
  listingMocks.rootLoading = false;
  listingMocks.childStates = new Map();
  listingMocks.rootRefresh.mockClear();
  listingMocks.childRefresh.mockClear();
});

describe('WorkspaceFileExplorer integration', () => {
  it('renders root listings and expands a folder without an update loop', async () => {
    listingMocks.childStates.set('src', {
      entries: listingMocks.srcChildEntries,
      isLoading: false,
    });

    render(<WorkspaceFileExplorer {...defaultProps} />);

    expect(screen.getByTitle('package.json')).toBeInTheDocument();
    expect(screen.queryByTitle('src/index.ts')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('src'));

    await waitFor(
      () => {
        expect(screen.getByTitle('src/index.ts')).toBeInTheDocument();
      },
      { timeout: 1000 }
    );
  });

  it('auto-expands revealPath without hanging', async () => {
    listingMocks.childStates.set('src', {
      entries: listingMocks.srcChildEntries,
      isLoading: false,
    });

    render(
      <WorkspaceFileExplorer
        {...defaultProps}
        revealPath="src/index.ts"
        selectedPath="src/index.ts"
      />
    );

    await waitFor(
      () => {
        expect(screen.getByTitle('src/index.ts')).toBeInTheDocument();
      },
      { timeout: 1000 }
    );
  });
});
