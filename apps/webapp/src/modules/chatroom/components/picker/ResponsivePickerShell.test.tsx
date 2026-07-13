import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { ResponsivePickerShell } from './ResponsivePickerShell';

const mockUseIsDesktop = vi.fn();

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

function renderShell(overrides: Record<string, unknown> = {}) {
  return render(
    <ResponsivePickerShell
      open={true}
      onOpenChange={vi.fn()}
      trigger={<button type="button">Open picker</button>}
      title="Test picker"
      {...overrides}
    >
      <div data-testid="picker-content">Picker content</div>
    </ResponsivePickerShell>
  );
}

describe('ResponsivePickerShell', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReset();
  });

  it('renders popover content when isDesktop is true', () => {
    mockUseIsDesktop.mockReturnValue(true);
    renderShell();

    const popoverContent = document.querySelector('[data-slot="chatroom-popover-content"]');
    expect(popoverContent).not.toBeNull();
    expect(popoverContent).toHaveTextContent('Picker content');
  });

  it('renders drawer content when isDesktop is false', () => {
    mockUseIsDesktop.mockReturnValue(false);
    renderShell();

    const drawerContent = document.querySelector('[data-slot="drawer-content"]');
    expect(drawerContent).not.toBeNull();
  });

  it('renders drawer with sr-only title when isDesktop is false', () => {
    mockUseIsDesktop.mockReturnValue(false);
    renderShell({ title: 'Custom Test Title' });

    const title = document.querySelector('[data-slot="drawer-title"]');
    expect(title).not.toBeNull();
    expect(title).toHaveClass('sr-only');
    expect(title).toHaveTextContent('Custom Test Title');
  });

  it('renders only trigger when disabled is true', () => {
    mockUseIsDesktop.mockReturnValue(true);
    renderShell({ disabled: true });

    expect(screen.getByRole('button', { name: 'Open picker' })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="chatroom-popover-content"]')).toBeNull();
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull();
  });

  it('renders only trigger when disabled is true on mobile', () => {
    mockUseIsDesktop.mockReturnValue(false);
    renderShell({ disabled: true });

    expect(screen.getByRole('button', { name: 'Open picker' })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="chatroom-popover-content"]')).toBeNull();
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull();
  });

  it('passes contentClassName to popover content', () => {
    mockUseIsDesktop.mockReturnValue(true);
    renderShell({ contentClassName: 'w-72' });

    const popoverContent = document.querySelector('[data-slot="chatroom-popover-content"]');
    expect(popoverContent?.className).toContain('w-72');
  });

  it('passes drawerContentClassName to drawer content', () => {
    mockUseIsDesktop.mockReturnValue(false);
    renderShell({ drawerContentClassName: 'custom-drawer-class' });

    const drawerContent = document.querySelector('[data-slot="drawer-content"]');
    expect(drawerContent?.className).toContain('custom-drawer-class');
  });
});
