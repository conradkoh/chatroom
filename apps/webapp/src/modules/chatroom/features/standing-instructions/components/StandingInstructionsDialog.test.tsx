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

describe('StandingInstructionsDialog', () => {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  const onEnable = vi.fn();
  const onDisable = vi.fn();
  const onDelete = vi.fn();
  const onRecordHistoryUse = vi
    .fn()
    .mockResolvedValue({ content: 'Always use TypeScript', title: 'Type safety' });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useIsDesktop).mockReturnValue(true);
  });

  it('renders dialog content on desktop', () => {
    vi.mocked(useIsDesktop).mockReturnValue(true);
    render(
      <StandingInstructionsDialog
        open={true}
        onOpenChange={onOpenChange}
        initialView="add"
        storedContent=""
        storedTitle=""
        isActive={false}
        history={mockHistory}
        onConfirm={onConfirm}
        onEnable={onEnable}
        onDisable={onDisable}
        onDelete={onDelete}
        onRecordHistoryUse={onRecordHistoryUse}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Create new')).toBeInTheDocument();
    expect(screen.getByText('View more')).toBeInTheDocument();
  });

  it('renders drawer on mobile', () => {
    vi.mocked(useIsDesktop).mockReturnValue(false);
    render(
      <StandingInstructionsDialog
        open={true}
        onOpenChange={onOpenChange}
        initialView="add"
        storedContent=""
        storedTitle=""
        isActive={false}
        history={mockHistory}
        onConfirm={onConfirm}
        onEnable={onEnable}
        onDisable={onDisable}
        onDelete={onDelete}
        onRecordHistoryUse={onRecordHistoryUse}
      />
    );

    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
  });

  it('shows Disable when isActive is true in actions view', () => {
    render(
      <StandingInstructionsDialog
        open={true}
        onOpenChange={onOpenChange}
        initialView="actions"
        storedContent="existing content"
        storedTitle=""
        isActive={true}
        history={mockHistory}
        onConfirm={onConfirm}
        onEnable={onEnable}
        onDisable={onDisable}
        onDelete={onDelete}
        onRecordHistoryUse={onRecordHistoryUse}
      />
    );

    expect(screen.getByText('Disable')).toBeInTheDocument();
    expect(screen.queryByText('Enable')).not.toBeInTheDocument();
  });

  it('shows Enable when isActive is false in actions view', () => {
    render(
      <StandingInstructionsDialog
        open={true}
        onOpenChange={onOpenChange}
        initialView="actions"
        storedContent="existing content"
        storedTitle=""
        isActive={false}
        history={mockHistory}
        onConfirm={onConfirm}
        onEnable={onEnable}
        onDisable={onDisable}
        onDelete={onDelete}
        onRecordHistoryUse={onRecordHistoryUse}
      />
    );

    expect(screen.getByText('Enable')).toBeInTheDocument();
    expect(screen.queryByText('Disable')).not.toBeInTheDocument();
  });

  it('selecting create-new reveals textarea', () => {
    render(
      <StandingInstructionsDialog
        open={true}
        onOpenChange={onOpenChange}
        initialView="add"
        storedContent=""
        storedTitle=""
        isActive={false}
        history={[]}
        onConfirm={onConfirm}
        onEnable={onEnable}
        onDisable={onDisable}
        onDelete={onDelete}
        onRecordHistoryUse={onRecordHistoryUse}
      />
    );

    expect(screen.queryByPlaceholderText('Enter standing instructions…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('standing-instructions-create-new'));
    expect(screen.getByPlaceholderText('Enter standing instructions…')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Title')).toBeInTheDocument();
  });

  it('Confirm is disabled until selection in add flow', () => {
    render(
      <StandingInstructionsDialog
        open={true}
        onOpenChange={onOpenChange}
        initialView="add"
        storedContent=""
        storedTitle=""
        isActive={false}
        history={[]}
        onConfirm={onConfirm}
        onEnable={onEnable}
        onDisable={onDisable}
        onDelete={onDelete}
        onRecordHistoryUse={onRecordHistoryUse}
      />
    );

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);
  });

  it('Confirm stays disabled with content but no title in create-new', () => {
    render(
      <StandingInstructionsDialog
        open={true}
        onOpenChange={onOpenChange}
        initialView="add"
        storedContent=""
        storedTitle=""
        isActive={false}
        history={[]}
        onConfirm={onConfirm}
        onEnable={onEnable}
        onDisable={onDisable}
        onDelete={onDelete}
        onRecordHistoryUse={onRecordHistoryUse}
      />
    );

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
    render(
      <StandingInstructionsDialog
        open={true}
        onOpenChange={onOpenChange}
        initialView="actions"
        storedContent="existing content"
        storedTitle="My Title"
        isActive={true}
        history={mockHistory}
        onConfirm={onConfirm}
        onEnable={onEnable}
        onDisable={onDisable}
        onDelete={onDelete}
        onRecordHistoryUse={onRecordHistoryUse}
      />
    );

    fireEvent.click(screen.getByText('Edit'));

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.hasAttribute('disabled')).toBe(false);
  });

  it('edit view Confirm is disabled when title is cleared', () => {
    render(
      <StandingInstructionsDialog
        open={true}
        onOpenChange={onOpenChange}
        initialView="actions"
        storedContent="existing content"
        storedTitle=""
        isActive={true}
        history={mockHistory}
        onConfirm={onConfirm}
        onEnable={onEnable}
        onDisable={onDisable}
        onDelete={onDelete}
        onRecordHistoryUse={onRecordHistoryUse}
      />
    );

    fireEvent.click(screen.getByText('Edit'));

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);
  });

  it('Ctrl+Enter on textarea with title calls onConfirm', () => {
    render(
      <StandingInstructionsDialog
        open={true}
        onOpenChange={onOpenChange}
        initialView="add"
        storedContent=""
        storedTitle=""
        isActive={false}
        history={[]}
        onConfirm={onConfirm}
        onEnable={onEnable}
        onDisable={onDisable}
        onDelete={onDelete}
        onRecordHistoryUse={onRecordHistoryUse}
      />
    );

    fireEvent.click(screen.getByTestId('standing-instructions-create-new'));
    const textarea = screen.getByPlaceholderText('Enter standing instructions…');
    fireEvent.change(textarea, { target: { value: 'test' } });
    const titleInput = screen.getByPlaceholderText('Title');
    fireEvent.change(titleInput, { target: { value: 'My title' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(onConfirm).toHaveBeenCalled();
  });

  it('Enable callback closes dialog via onOpenChange(false)', () => {
    render(
      <StandingInstructionsDialog
        open={true}
        onOpenChange={onOpenChange}
        initialView="actions"
        storedContent="existing"
        storedTitle=""
        isActive={false}
        history={[]}
        onConfirm={onConfirm}
        onEnable={onEnable}
        onDisable={onDisable}
        onDelete={onDelete}
        onRecordHistoryUse={onRecordHistoryUse}
      />
    );

    fireEvent.click(screen.getByText('Enable'));
    expect(onEnable).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
