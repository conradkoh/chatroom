import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { StandingInstructionsDialog } from './StandingInstructionsDialog';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';

import { useIsDesktop } from '@/hooks/useIsDesktop';

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: vi.fn(() => true),
}));

vi.mock('@/hooks/useMobileKeyboard', () => ({
  useVisualViewportKeyboardInset: () => 0,
}));

const mockHistory: StandingInstructionHistoryItem[] = [
  {
    id: 'h1',
    content: 'Always use TypeScript',
    title: 'Type safety',
    useCount: 10,
    lastUsedAt: 5000,
  },
  { id: 'h2', content: 'Write unit tests', title: 'Tests first', useCount: 5, lastUsedAt: 4000 },
];

function renderDialog(overrides: Partial<Parameters<typeof StandingInstructionsDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  const onRecordHistoryUse = vi
    .fn()
    .mockResolvedValue({ content: 'Always use TypeScript', title: 'Type safety' });

  render(
    <StandingInstructionsDialog
      open={true}
      onOpenChange={onOpenChange}
      initialView="add"
      storedContent=""
      storedTitle=""
      history={mockHistory}
      onConfirm={onConfirm}
      onRecordHistoryUse={onRecordHistoryUse}
      {...overrides}
    />
  );

  return { onOpenChange, onConfirm, onRecordHistoryUse };
}

describe('StandingInstructionsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useIsDesktop).mockReturnValue(true);
  });

  it('renders dialog content on desktop', () => {
    vi.mocked(useIsDesktop).mockReturnValue(true);
    renderDialog();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Create new')).toBeInTheDocument();
    expect(screen.getByText('View more')).toBeInTheDocument();
  });

  it('renders drawer on mobile', () => {
    vi.mocked(useIsDesktop).mockReturnValue(false);
    renderDialog();

    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
  });

  it('selecting create-new reveals textarea and title input', () => {
    renderDialog({ history: [] });

    expect(screen.queryByPlaceholderText('Enter standing instructions…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('standing-instructions-create-new'));
    expect(screen.getByPlaceholderText('Enter standing instructions…')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Title')).toBeInTheDocument();
  });

  it('Confirm is disabled until selection in add flow', () => {
    renderDialog({ history: [] });

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);
  });

  it('Confirm stays disabled with content but no title in create-new', () => {
    renderDialog({ history: [] });

    fireEvent.click(screen.getByTestId('standing-instructions-create-new'));
    const textarea = screen.getByPlaceholderText('Enter standing instructions…');
    fireEvent.change(textarea, { target: { value: 'test' } });

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);

    const titleInput = screen.getByPlaceholderText('Title');
    fireEvent.change(titleInput, { target: { value: 'My title' } });
    expect(confirmBtn.hasAttribute('disabled')).toBe(false);
  });

  it('edit view Confirm is enabled when content and title are present', () => {
    renderDialog({
      initialView: 'edit',
      storedContent: 'existing content',
      storedTitle: 'My Title',
    });

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.hasAttribute('disabled')).toBe(false);
  });

  it('edit view Confirm is disabled when title is cleared', () => {
    renderDialog({
      initialView: 'edit',
      storedContent: 'existing content',
      storedTitle: '',
    });

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);
  });

  it('Ctrl+Enter on textarea with title calls onConfirm', () => {
    const { onConfirm } = renderDialog({ history: [] });

    fireEvent.click(screen.getByTestId('standing-instructions-create-new'));
    const textarea = screen.getByPlaceholderText('Enter standing instructions…');
    fireEvent.change(textarea, { target: { value: 'test' } });
    const titleInput = screen.getByPlaceholderText('Title');
    fireEvent.change(titleInput, { target: { value: 'My title' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(onConfirm).toHaveBeenCalled();
  });

  it('mobile drawer footer has Cancel before Confirm', () => {
    vi.mocked(useIsDesktop).mockReturnValue(false);
    renderDialog({ initialView: 'edit', storedContent: 'content', storedTitle: 'Title' });

    const footer = screen.getByTestId('standing-instructions-dialog-footer');
    const buttons = footer.querySelectorAll('button');
    expect(buttons[0]?.textContent).toBe('Cancel');
    expect(buttons[1]?.textContent).toBe('Confirm');
  });

  it('mobile drawer does not show footer on history view', () => {
    vi.mocked(useIsDesktop).mockReturnValue(false);
    renderDialog();

    fireEvent.click(screen.getByTestId('standing-instructions-view-more'));
    expect(screen.getByPlaceholderText('Search history…')).toBeInTheDocument();
    expect(screen.queryByTestId('standing-instructions-dialog-footer')).not.toBeInTheDocument();
  });
});
