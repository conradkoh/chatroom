import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PickerMobileChrome } from './PickerMobileChrome';
import { PickerShellProvider } from './PickerShellContext';

describe('PickerMobileChrome', () => {
  it('hides children while mobile keyboard is open', () => {
    render(<PickerShellProvider value={{ mobileKeyboardOpen: true }}><PickerMobileChrome>Chrome</PickerMobileChrome></PickerShellProvider>);
    expect(screen.queryByText('Chrome')).not.toBeInTheDocument();
  });
  it('renders children otherwise', () => {
    render(<PickerShellProvider value={{ mobileKeyboardOpen: false }}><PickerMobileChrome>Chrome</PickerMobileChrome></PickerShellProvider>);
    expect(screen.getByText('Chrome')).toBeInTheDocument();
  });
});
