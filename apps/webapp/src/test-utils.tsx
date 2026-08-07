import { type RenderOptions, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { expect } from 'vitest';

/**
 * Custom render function that can be extended with providers, mocks, etc.
 * This is useful for wrapping components with context providers or other setup.
 *
 * @example
 * ```tsx
 * import { renderWithProviders } from '@/test-utils';
 *
 * test('my component', () => {
 *   renderWithProviders(<MyComponent />);
 * });
 * ```
 */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, {
    ...options,
  });
}

/**
 * Render function that returns a userEvent instance for interacting with the component.
 *
 * @example
 * ```tsx
 * import { renderWithUser } from '@/test-utils';
 *
 * test('my component', async () => {
 *   const { user, getByLabelText } = renderWithUser(<MyComponent />);
 *   const input = getByLabelText('Name');
 *   await user.type(input, 'Alice');
 * });
 * ```
 */
export function renderWithUser(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return {
    user: userEvent.setup(),
    ...render(ui, { ...options }),
  };
}

// Re-export everything from React Testing Library
export * from '@testing-library/react';
export { userEvent };

export async function waitForOpenContent(testIdOrSelector: string, isSelector = false) {
  await waitFor(() => {
    const el = isSelector
      ? document.querySelector(testIdOrSelector)
      : document.querySelector(`[data-slot="${testIdOrSelector}"]`);
    expect(el).toBeInTheDocument();
  });
}
