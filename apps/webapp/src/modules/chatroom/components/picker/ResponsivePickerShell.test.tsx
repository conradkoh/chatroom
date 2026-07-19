import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PickerScrollBody } from './PickerScrollBody';
import { PickerSearch } from './PickerSearch';
import { ResponsivePickerShell } from './ResponsivePickerShell';
import { OverlayPortalContainerProvider } from '../shared/overlayPortalContainer';

const mockUseIsDesktop = vi.fn();
const mockUseKeyboardInset = vi.fn();

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

vi.mock('@/hooks/useMobileKeyboard', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    useVisualViewportKeyboardInset: () => mockUseKeyboardInset(),
  };
});

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

  it('renders drawer handle on mobile', () => {
    mockUseIsDesktop.mockReturnValue(false);
    renderShell();
    const handle = document.querySelector('[data-slot="drawer-handle"]');
    expect(handle).not.toBeNull();
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

  describe('anchorToPointer', () => {
    it('uses center alignment on desktop when anchorToPointer is true', () => {
      mockUseIsDesktop.mockReturnValue(true);
      renderShell({ anchorToPointer: true });

      const popoverContent = document.querySelector('[data-slot="chatroom-popover-content"]');
      expect(popoverContent).not.toBeNull();
      expect(popoverContent).toHaveAttribute('data-align', 'center');
    });

    it('uses start alignment when anchorToPointer is not set', () => {
      mockUseIsDesktop.mockReturnValue(true);
      renderShell();

      const popoverContent = document.querySelector('[data-slot="chatroom-popover-content"]');
      expect(popoverContent).not.toBeNull();
      expect(popoverContent).toHaveAttribute('data-align', 'start');
    });

    it('does not affect mobile drawer', () => {
      mockUseIsDesktop.mockReturnValue(false);
      renderShell({ anchorToPointer: true });

      const drawerContent = document.querySelector('[data-slot="drawer-content"]');
      expect(drawerContent).not.toBeNull();
    });
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

  it('applies paddingBottom style on mobile when keyboard inset is non-zero', () => {
    mockUseIsDesktop.mockReturnValue(false);
    mockUseKeyboardInset.mockReturnValue(120);
    renderShell();

    const drawerContent = document.querySelector('[data-slot="drawer-content"]') as HTMLElement;
    expect(drawerContent?.getAttribute('style')).toContain('120px');
  });

  it('includes safe-area horizontal padding on mobile drawer', () => {
    mockUseIsDesktop.mockReturnValue(false);
    renderShell();

    const drawerContent = document.querySelector('[data-slot="drawer-content"]') as HTMLElement;
    expect(drawerContent?.getAttribute('style')).not.toBeNull();
    expect(drawerContent?.getAttribute('style')).not.toBe('');
  });

  it('does not apply paddingBottom style on desktop when keyboard inset is non-zero', () => {
    mockUseIsDesktop.mockReturnValue(true);
    mockUseKeyboardInset.mockReturnValue(120);
    renderShell();

    const popoverContent = document.querySelector(
      '[data-slot="chatroom-popover-content"]'
    ) as HTMLElement;
    expect(popoverContent?.style.paddingBottom).toBe('');
  });

  it('calls onOpenChange(true) when trigger clicked on desktop', async () => {
    mockUseIsDesktop.mockReturnValue(true);
    const onOpenChange = vi.fn();
    render(
      <ResponsivePickerShell
        open={false}
        onOpenChange={onOpenChange}
        trigger={<button type="button">Open</button>}
        title="Test"
      >
        <div>content</div>
      </ResponsivePickerShell>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('calls onOpenChange(true) when trigger clicked on mobile', async () => {
    mockUseIsDesktop.mockReturnValue(false);
    const onOpenChange = vi.fn();
    render(
      <ResponsivePickerShell
        open={false}
        onOpenChange={onOpenChange}
        trigger={<button type="button">Open</button>}
        title="Test"
      >
        <div>content</div>
      </ResponsivePickerShell>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('portals drawer content into overlay container when provided', () => {
    mockUseIsDesktop.mockReturnValue(false);
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(
      <OverlayPortalContainerProvider container={container}>
        <ResponsivePickerShell
          open={true}
          onOpenChange={vi.fn()}
          trigger={<button type="button">Open picker</button>}
          title="Test picker"
        >
          <div data-testid="picker-content">Picker content</div>
        </ResponsivePickerShell>
      </OverlayPortalContainerProvider>
    );
    const drawerContent = document.querySelector('[data-slot="drawer-content"]');
    expect(drawerContent).not.toBeNull();
    expect(container.contains(drawerContent)).toBe(true);
    document.body.removeChild(container);
  });

  it('popover portals into overlay container when provided', () => {
    mockUseIsDesktop.mockReturnValue(true);
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(
      <OverlayPortalContainerProvider container={container}>
        <ResponsivePickerShell
          open={true}
          onOpenChange={vi.fn()}
          trigger={<button type="button">Open picker</button>}
          title="Test picker"
        >
          <div data-testid="picker-content">Picker content</div>
        </ResponsivePickerShell>
      </OverlayPortalContainerProvider>
    );
    const popoverContent = document.querySelector('[data-slot="chatroom-popover-content"]');
    expect(popoverContent).not.toBeNull();
    expect(container.contains(popoverContent)).toBe(true);
    document.body.removeChild(container);
  });

  it('applies flex scroll layout to PickerScrollBody in mobile drawer', () => {
    mockUseIsDesktop.mockReturnValue(false);
    render(
      <ResponsivePickerShell
        open={true}
        onOpenChange={vi.fn()}
        trigger={<button type="button">Open</button>}
        title="Test"
      >
        <PickerSearch value="" onChange={vi.fn()} />
        <PickerScrollBody>
          <div>Option</div>
        </PickerScrollBody>
      </ResponsivePickerShell>
    );

    const scrollBody = document.querySelector('[data-picker-scroll-body]');
    expect(scrollBody).not.toBeNull();
    const wrapper = scrollBody?.parentElement;
    expect(wrapper?.className).toContain('flex-col');
    expect(wrapper?.className).toContain('overflow-hidden');
  });
});
