import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StandingInstructionsPicker } from './StandingInstructionsPicker';
import type { PickerListItem } from './standingInstructionsPickerUtils';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';

const mockToastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

const mockUseIsDesktop = vi.fn(() => true);

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

vi.mock('@/hooks/useMobileKeyboard', () => ({
  useVisualViewportKeyboardInset: () => 0,
  useVisualViewportOffsetTop: () => 0,
}));

const history: StandingInstructionHistoryItem[] = [
  {
    id: 'h1',
    content: 'Always use TypeScript',
    title: 'Type safety',
    useCount: 10,
    lastUsedAt: 5000,
  },
  {
    id: 'h2',
    content: 'Use async/await',
    title: 'Async patterns',
    useCount: 8,
    lastUsedAt: 4000,
  },
  {
    id: 'h3',
    content: 'Write tests',
    title: 'Tests',
    useCount: 5,
    lastUsedAt: 3000,
  },
];

function renderPicker(
  overrides: Partial<{
    isActive: boolean;
    hasContent: boolean;
    storedContent: string;
    storedTitle: string;
    history: StandingInstructionHistoryItem[];
    onConfirm: (payload: { content: string; title: string }) => void | Promise<void>;
    onEnable: () => void | Promise<void>;
    onDisable: () => void | Promise<void>;
    onEditItem: (
      item: PickerListItem,
      payload: { content: string; title: string }
    ) => void | Promise<void>;
    onDeleteItem: (item: PickerListItem) => void | Promise<void>;
  }> = {}
) {
  const onConfirm = vi.fn();
  const onEnable = vi.fn();
  const onDisable = vi.fn();
  const onEditItem = vi.fn();
  const onDeleteItem = vi.fn();

  render(
    <StandingInstructionsPicker
      open
      onOpenChange={vi.fn()}
      storedContent={overrides.storedContent ?? 'Always use TypeScript'}
      storedTitle={overrides.storedTitle ?? 'Type safety'}
      isActive={overrides.isActive ?? true}
      hasContent={overrides.hasContent ?? true}
      history={overrides.history ?? history}
      onConfirm={overrides.onConfirm ?? onConfirm}
      onEnable={overrides.onEnable ?? onEnable}
      onDisable={overrides.onDisable ?? onDisable}
      onEditItem={overrides.onEditItem ?? onEditItem}
      onDeleteItem={overrides.onDeleteItem ?? onDeleteItem}
    />
  );

  return { onConfirm, onEnable, onDisable, onEditItem, onDeleteItem };
}

describe('StandingInstructionsPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsDesktop.mockReturnValue(true);
  });

  it('renders list rows from util on desktop dialog', () => {
    renderPicker();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Type safety')).toBeInTheDocument();
    expect(screen.getByText('Async patterns')).toBeInTheDocument();
    expect(screen.getByText('Tests')).toBeInTheDocument();
  });

  it('shows visible dialog heading on desktop', () => {
    renderPicker();
    expect(screen.getByRole('heading', { name: 'Standing instructions' })).toBeInTheDocument();
  });

  it('shows View more in header when hasMore and opens history modal on click', async () => {
    const user = userEvent.setup();
    const fourItemHistory: StandingInstructionHistoryItem[] = [
      ...history,
      {
        id: 'h4',
        content: 'Fourth rule',
        title: 'Fourth',
        useCount: 1,
        lastUsedAt: 2000,
      },
    ];
    renderPicker({ history: fourItemHistory, isActive: true });

    const viewMore = screen.getByTestId('standing-instructions-view-more');
    expect(viewMore).toBeInTheDocument();
    await user.click(viewMore);
    expect(screen.getByText('Standing instruction history')).toBeInTheDocument();
  });

  it('does not show View more when hasMore is false', () => {
    renderPicker({ history: [], isActive: true, storedContent: 'x', storedTitle: 'y' });
    expect(screen.queryByTestId('standing-instructions-view-more')).not.toBeInTheDocument();
  });

  it('shows Update when active and a different item is selected', async () => {
    const user = userEvent.setup();
    renderPicker();
    const updateBtn = screen.getByText('Update');
    expect(updateBtn).toBeDisabled();

    await user.click(screen.getByText('Async patterns'));
    expect(screen.getByText('Update')).not.toBeDisabled();
  });

  it('shows Apply when inactive with a selection', async () => {
    const user = userEvent.setup();
    renderPicker({ isActive: false });
    expect(screen.getByText('Apply')).toBeDisabled();

    await user.click(screen.getByText('Async patterns'));
    expect(screen.getByText('Apply')).not.toBeDisabled();
    expect(screen.queryByText('Update')).not.toBeInTheDocument();
  });

  it('calls onDisable when Disable is clicked', async () => {
    const user = userEvent.setup();
    const { onDisable } = renderPicker();
    await user.click(screen.getByText('Disable'));
    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  it('Disable button uses outlined destructive text styling', () => {
    renderPicker();
    const disableBtn = screen.getByText('Disable');
    expect(disableBtn.className).toContain('bg-red-50');
    expect(disableBtn.className).toContain('text-red-600');
    expect(disableBtn.className).toContain('border-red-200');
    expect(disableBtn.className).toContain('h-9');
    expect(disableBtn.className).toContain('text-sm');
  });

  it('Apply uses display title for legacy empty-title history rows', async () => {
    const user = userEvent.setup();
    const legacyHistory: StandingInstructionHistoryItem[] = [
      {
        id: 'legacy',
        content: 'Always use TypeScript',
        title: '',
        useCount: 1,
        lastUsedAt: 1000,
      },
      {
        id: 'h2',
        content: 'Other rule',
        title: 'Other',
        useCount: 1,
        lastUsedAt: 900,
      },
    ];
    const { onConfirm } = renderPicker({
      isActive: false,
      storedContent: 'Other rule',
      storedTitle: 'Other',
      history: legacyHistory,
    });

    const legacyOption = screen
      .getAllByRole('option')
      .find((option) => option.textContent?.includes('Always use TypeScript'));
    expect(legacyOption).toBeDefined();
    await user.click(legacyOption!);
    await user.click(screen.getByText('Apply'));

    expect(onConfirm).toHaveBeenCalledWith({
      content: 'Always use TypeScript',
      title: 'Always use TypeScript',
    });
  });

  it('active with empty history shows synthetic row, Disable, and hidden Update', () => {
    renderPicker({ history: [] });
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Disable')).toBeInTheDocument();
    expect(screen.getByText('Update')).toBeDisabled();
  });

  it('hides Enable when a selection is pending', async () => {
    const user = userEvent.setup();
    renderPicker({ isActive: false });
    expect(screen.getByText('Enable')).toBeInTheDocument();

    await user.click(screen.getByText('Async patterns'));
    expect(screen.queryByText('Enable')).not.toBeInTheDocument();
  });

  it('shows Create new button in picker', () => {
    renderPicker();
    expect(screen.getByTestId('standing-instructions-create-new')).toBeInTheDocument();
  });

  it('Create new opens create dialog', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByTestId('standing-instructions-create-new'));
    expect(screen.getByText('Create standing instruction')).toBeInTheDocument();
  });

  it('create flow calls onConfirm and closes picker', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <StandingInstructionsPicker
        open
        onOpenChange={onOpenChange}
        storedContent=""
        storedTitle=""
        isActive={false}
        hasContent={false}
        history={[]}
        onConfirm={onConfirm}
        onEnable={vi.fn()}
        onDisable={vi.fn()}
        onEditItem={vi.fn()}
        onDeleteItem={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('standing-instructions-create-new'));
    await user.type(screen.getByPlaceholderText('Enter standing instructions…'), 'new rule');
    await user.type(screen.getByPlaceholderText('Title'), 'New title');
    await user.click(screen.getByText('Confirm'));

    expect(onConfirm).toHaveBeenCalledWith({ content: 'new rule', title: 'New title' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('edit icon opens edit dialog', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getAllByLabelText('Edit')[0]);
    expect(screen.getByText('Edit standing instruction')).toBeInTheDocument();
  });

  it('delete icon opens confirm dialog', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getAllByLabelText('Delete')[0]);
    expect(screen.getByText('Delete standing instruction?')).toBeInTheDocument();
  });

  it('synthetic current item shows delete and confirms with synthetic-specific copy', async () => {
    const user = userEvent.setup();
    const { onDeleteItem } = renderPicker({
      history: [],
      isActive: true,
      storedContent: 'Current rule',
      storedTitle: 'Current',
    });

    await user.click(screen.getAllByLabelText('Delete')[0]);
    expect(
      screen.getByText('Clear this standing instruction and disable it in this chatroom?')
    ).toBeInTheDocument();

    await user.click(screen.getByText('Delete'));
    expect(onDeleteItem).toHaveBeenCalledTimes(1);
  });

  it('keeps edit modal open and shows toast when save fails', async () => {
    const user = userEvent.setup();
    const onEditItem = vi.fn().mockRejectedValue(new Error('CONFLICT: already exists'));
    renderPicker({ onEditItem });
    await user.click(screen.getAllByLabelText('Edit')[0]);
    await user.click(screen.getByText('Confirm'));
    expect(screen.getByText('Edit standing instruction')).toBeInTheDocument();
    expect(mockToastError).toHaveBeenCalled();
  });
});
