import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MobileKeyboardDrawer } from './MobileKeyboardDrawer';
import { usePickerShell } from './PickerShellContext';

vi.mock('@/hooks/useMobileKeyboard', () => ({
  useVisualViewportKeyboardInset: () => 300,
  useVisualViewportOffsetTop: () => 0,
}));

function Probe() { return <span>{usePickerShell().mobileKeyboardOpen ? 'keyboard-open' : 'keyboard-closed'}</span>; }

describe('MobileKeyboardDrawer', () => {
  it('renders children and provides keyboard state', () => {
    render(<MobileKeyboardDrawer open onOpenChange={vi.fn()} title="Test"><Probe /></MobileKeyboardDrawer>);
    expect(screen.getByText('keyboard-open')).toBeInTheDocument();
  });
});
