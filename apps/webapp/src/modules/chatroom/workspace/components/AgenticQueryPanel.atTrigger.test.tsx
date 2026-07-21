/**
 * AgenticQueryPanel — @ file trigger integration tests (real autocomplete wiring).
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgenticQueryPanel } from './AgenticQueryPanel';

import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';

const mockSubmit = vi.fn();
const mockOnAtTriggerActivate = vi.fn();

beforeAll(() => {
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
});

vi.mock('../hooks/useAgenticQuery', () => ({
  useAgenticQuery: () => ({
    query: { status: 'draft', mode: 'search', title: 'Agentic Search' },
    turns: [],
    isLoading: false,
    isRunning: false,
    isDraft: true,
    canFollowUp: false,
    canSubmit: true,
    activeRunId: undefined,
    submit: mockSubmit,
  }),
}));

vi.mock('../hooks/useAgenticQueryHarnessSelection', () => ({
  useAgenticQueryHarnessSelection: () => ({
    harnesses: [{ name: 'opencode-sdk', label: 'SDK', providers: [] }],
    harnessName: 'opencode-sdk',
    setHarnessName: vi.fn(),
    providers: [],
    selectedModel: '',
    setSelectedModel: vi.fn(),
    isModelHidden: undefined,
    selectionReady: true,
    toSubmitSelection: () => ({ harnessName: 'opencode-sdk' }),
    isLoading: false,
    machineId: 'machine-1',
    filter: { isHidden: undefined, setFilter: vi.fn(), enabled: true },
    currentEntry: null,
    applyConfig: vi.fn(),
    favorites: [],
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
    moveFavorite: vi.fn(),
    isFavorite: () => false,
    favoritesLoading: false,
  }),
}));

vi.mock('./AgenticQueryHarnessSync', () => ({
  AgenticQueryHarnessSync: () => null,
}));

vi.mock('../../direct-harness/hooks/useRefreshCapabilities', () => ({
  useRefreshCapabilities: () => ({ refresh: vi.fn() }),
}));

vi.mock('../hooks/useAgenticQueryRunTurnStore', () => ({
  useAgenticQueryRunTurnStore: () => ({
    turns: [],
    streamingOverlay: null,
    isLoading: false,
  }),
}));

const REGISTRY_WORKSPACE_ID = 'jd7fake_registry_workspace_id';

function renderAgenticComposer(
  fileEntries: FileEntry[] = [],
  options: { hasAutocompleteWorkspace?: boolean } = {}
) {
  const { hasAutocompleteWorkspace = fileEntries.length > 0 } = options;
  return render(
    <AgenticQueryPanel
      queryId="query-1"
      mode="search"
      workspaceId={REGISTRY_WORKSPACE_ID}
      autocompleteFiles={fileEntries}
      hasAutocompleteWorkspace={hasAutocompleteWorkspace}
      onAtTriggerActivate={mockOnAtTriggerActivate}
    />
  );
}

describe('AgenticQueryPanel @ trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmit.mockResolvedValue(undefined);
  });

  it('shows file results when typing @ with shared autocomplete files', async () => {
    const files: FileEntry[] = [
      { path: 'src/a.ts', type: 'file' },
      { path: 'src/b.ts', type: 'file' },
    ];
    renderAgenticComposer(files);

    const textarea = screen.getByTestId('agentic-query-composer-input');
    fireEvent.change(textarea, { target: { value: '@', selectionStart: 1 } });

    await waitFor(() => {
      expect(screen.getByText('a.ts')).toBeInTheDocument();
      expect(screen.getByText('b.ts')).toBeInTheDocument();
    });
  });

  it('does not enable autocomplete when no workspace and no files', async () => {
    renderAgenticComposer([], { hasAutocompleteWorkspace: false });

    const textarea = screen.getByTestId('agentic-query-composer-input');
    fireEvent.change(textarea, { target: { value: '@', selectionStart: 1 } });

    await waitFor(() => {
      expect(screen.queryByText('a.ts')).not.toBeInTheDocument();
    });
  });

  it('inserts the highlighted file on Enter without submitting', async () => {
    const files: FileEntry[] = [
      { path: 'src/a.ts', type: 'file' },
      { path: 'src/b.ts', type: 'file' },
    ];
    renderAgenticComposer(files);

    const textarea = screen.getByTestId('agentic-query-composer-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@src', selectionStart: 4 } });

    await waitFor(() => {
      expect(document.querySelectorAll('[data-autocomplete-item]')).toHaveLength(2);
    });

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(textarea.value).toContain('src/b.ts');
    });
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('calls onAtTriggerActivate when @ activates', async () => {
    renderAgenticComposer([{ path: 'src/a.ts', type: 'file' }]);

    const textarea = screen.getByTestId('agentic-query-composer-input');
    fireEvent.change(textarea, { target: { value: '@', selectionStart: 1 } });

    await waitFor(() => {
      expect(mockOnAtTriggerActivate).toHaveBeenCalled();
    });
  });

  it('positions the dropdown below the composer (top anchor)', async () => {
    renderAgenticComposer([{ path: 'src/a.ts', type: 'file' }]);

    const textarea = screen.getByTestId('agentic-query-composer-input');
    fireEvent.change(textarea, { target: { value: '@', selectionStart: 1 } });

    await waitFor(() => {
      const dropdown = document.querySelector('[data-autocomplete-item]')?.parentElement
        ?.parentElement;
      expect(dropdown).toBeTruthy();
      expect(dropdown?.style.top).not.toBe('');
      expect(dropdown?.style.bottom).toBe('');
    });
  });
});
