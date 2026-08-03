import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StandingInstructionsPicker } from './StandingInstructionsPicker';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';

const mockUseIsDesktop = vi.fn(() => true);

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

vi.mock('@/hooks/useMobileKeyboard', () => ({
  useVisualViewportKeyboardInset: () => 0,
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
  }> = {}
) {
  const onConfirm = vi.fn();
  const onEnable = vi.fn();
  const onDisable = vi.fn();

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
    />
  );

  return { onConfirm, onEnable, onDisable };
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
      />
    );

    await user.click(screen.getByTestId('standing-instructions-create-new'));
    await user.type(screen.getByPlaceholderText('Enter standing instructions…'), 'new rule');
    await user.type(screen.getByPlaceholderText('Title'), 'New title');
    await user.click(screen.getByText('Confirm'));

    expect(onConfirm).toHaveBeenCalledWith({ content: 'new rule', title: 'New title' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
