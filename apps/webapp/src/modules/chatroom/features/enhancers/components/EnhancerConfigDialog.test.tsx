import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { EnhancerConfigDialog } from './EnhancerConfigDialog';
import type { EnhancerConfig } from '../types/enhancer';
import type { EnhancerConfigEntry } from '../types/enhancerConfigEntry';

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: vi.fn(() => true),
}));

vi.mock('@/hooks/useMobileKeyboard', () => ({
  useVisualViewportKeyboardInset: () => 0,
  useVisualViewportOffsetTop: () => 0,
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => [],
  useSessionMutation: () => vi.fn(),
}));

vi.mock('@/hooks/useMachineModels', () => ({
  useMachineModels: () => ({ availableModels: {}, isLoading: false }),
}));

vi.mock('./EnhancerHarnessModelSelect', () => ({
  EnhancerHarnessModelSelect: ({ machineId }: { machineId?: string | null }) =>
    !machineId ? (
      <p className="text-xs text-chatroom-text-muted">
        Select a workspace with a connected machine to choose a model.
      </p>
    ) : null,
}));

const CHATROOM_ID = 'room-1';

function makeConfig(overrides?: Partial<EnhancerConfig>): EnhancerConfig {
  return {
    enabled: true,
    targetId: 'handoff:planner-to-builder',
    agentHarness: 'opencode',
    model: 'anthropic/claude-opus-4',
    machineId: 'machine-1',
    ...overrides,
  };
}

const mockFavoritesProps = {
  favorites: [] as EnhancerConfigEntry[],
  isFavorite: () => false,
  onAddFavorite: vi.fn(),
  onRemoveFavorite: vi.fn(),
  onMoveFavorite: vi.fn(),
};

describe('EnhancerConfigDialog', () => {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the target section', () => {
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId={null}
        initialConfig={null}
        onConfirm={onConfirm}
        {...mockFavoritesProps}
      />
    );

    expect(screen.getByText('Enhancer configuration')).toBeDefined();
    expect(screen.getByText('Planning review (before builder)')).toBeDefined();
  });

  it('shows helper text when no machineId provided', () => {
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId={null}
        initialConfig={null}
        onConfirm={onConfirm}
        {...mockFavoritesProps}
      />
    );

    expect(
      screen.getByText('Select a workspace with a connected machine to choose a model.')
    ).toBeDefined();
  });

  it('disables Save when required fields are missing', () => {
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId={null}
        initialConfig={null}
        onConfirm={onConfirm}
        {...mockFavoritesProps}
      />
    );

    const targetButton = screen.getByText('Planning review (before builder)');
    fireEvent.click(targetButton);

    const saveButton = screen.getByText('Save & Enable');
    expect(saveButton.hasAttribute('disabled')).toBe(true);
  });

  it('shows Save & Enable label when config is disabled', () => {
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId="machine-1"
        initialConfig={makeConfig({ enabled: false })}
        onConfirm={onConfirm}
        {...mockFavoritesProps}
      />
    );
    expect(screen.getByText('Save & Enable')).toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });

  it('shows Save label when config is already enabled', () => {
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId="machine-1"
        initialConfig={makeConfig({ enabled: true })}
        onConfirm={onConfirm}
        {...mockFavoritesProps}
      />
    );
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.queryByText('Save & Enable')).not.toBeInTheDocument();
  });

  it('calls onConfirm with enabled true when saving while disabled', () => {
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId="machine-1"
        initialConfig={makeConfig({ enabled: false })}
        onConfirm={onConfirm}
        {...mockFavoritesProps}
      />
    );

    fireEvent.click(screen.getByText('Save & Enable'));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        machineId: 'machine-1',
      })
    );
  });

  it('calls onOpenChange(false) on Cancel', () => {
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId={null}
        initialConfig={null}
        onConfirm={onConfirm}
        {...mockFavoritesProps}
      />
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders favorites list with reorder controls when current config is favorited', () => {
    const favorite = {
      targetId: 'handoff:planner-to-builder' as const,
      agentHarness: 'opencode' as const,
      model: 'anthropic/claude-opus-4',
    };
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId="machine-1"
        initialConfig={makeConfig()}
        onConfirm={onConfirm}
        favorites={[favorite]}
        isFavorite={() => true}
        onAddFavorite={vi.fn()}
        onRemoveFavorite={vi.fn()}
        onMoveFavorite={vi.fn()}
      />
    );

    expect(screen.getByText('Current config is favorited')).toBeInTheDocument();
    const starredIndicator = screen.getByText('Current config is favorited');
    const favoritesList = screen.getByTestId('enhancer-config-favorites-list');
    expect(
      starredIndicator.compareDocumentPosition(favoritesList) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByLabelText('Move up')).toBeInTheDocument();
    expect(screen.getByLabelText('Move down')).toBeInTheDocument();
    expect(screen.queryByText('Add current config to favorites')).toBeNull();
  });

  it('renders favorites below target section when provided', () => {
    const favorite = {
      targetId: 'handoff:planner-to-builder' as const,
      agentHarness: 'opencode' as const,
      model: 'anthropic/claude-opus-4',
    };
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId="machine-1"
        initialConfig={makeConfig()}
        onConfirm={onConfirm}
        favorites={[favorite]}
        isFavorite={() => true}
        onAddFavorite={vi.fn()}
        onRemoveFavorite={vi.fn()}
        onMoveFavorite={vi.fn()}
      />
    );

    const targetLabel = screen.getByText('Target');
    const favoritesList = screen.getByTestId('enhancer-config-favorites-list');
    expect(
      targetLabel.compareDocumentPosition(favoritesList) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('syncs form state when initialConfig arrives after open', () => {
    const { rerender } = render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId="machine-1"
        initialConfig={null}
        onConfirm={onConfirm}
        {...mockFavoritesProps}
      />
    );

    expect(screen.getByText('Save & Enable').hasAttribute('disabled')).toBe(true);

    rerender(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId="machine-1"
        initialConfig={makeConfig({ model: 'anthropic/claude-sonnet-4' })}
        onConfirm={onConfirm}
        {...mockFavoritesProps}
      />
    );

    expect(screen.getByText('Save').hasAttribute('disabled')).toBe(false);
  });
});
