import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgenticQueryConfigModal } from './AgenticQueryConfigModal';

import type { UseMachineModelFilterResult } from '@/modules/chatroom/components/model-selection';
import type { SearchConfigEntry } from '@/modules/chatroom/features/search-config/types/searchConfig';

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => undefined,
  useSessionMutation: () => vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    web: {
      directHarness: {
        commands: {
          refreshCapabilities: 'refreshCapabilities',
        },
      },
    },
    machineConfigFavorites: {
      getMachineConfigFavorites: 'getMachineConfigFavorites',
      setMachineConfigFavorites: 'setMachineConfigFavorites',
    },
  },
}));

vi.mock('./WorkspaceCapabilitiesRefreshButton', () => ({
  WorkspaceCapabilitiesRefreshButton: () => null,
}));

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

const filter = {
  filter: null,
  setFilter: vi.fn(),
  isHidden: () => false,
  enabled: false,
} satisfies UseMachineModelFilterResult;

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  workspaceId: 'ws-1',
  harnesses: [],
  harnessName: '',
  onHarnessChange: vi.fn(),
  providers: [],
  selectedModel: '',
  onModelChange: vi.fn(),
  filter,
  currentEntry: null,
  isFavorite: () => false,
  onAddFavorite: vi.fn(),
  onApplyConfig: vi.fn(),
  onRemoveFavorite: vi.fn(),
  onMoveFavorite: vi.fn(),
  favorites: [] as SearchConfigEntry[],
};

describe('AgenticQueryConfigModal', () => {
  it('does not clip picker popovers via overflow-hidden on dialog content', () => {
    render(<AgenticQueryConfigModal {...baseProps} />);
    const modal = screen.getByTestId('agentic-query-config-modal');
    expect(modal.className).not.toContain('overflow-hidden');
  });
});
