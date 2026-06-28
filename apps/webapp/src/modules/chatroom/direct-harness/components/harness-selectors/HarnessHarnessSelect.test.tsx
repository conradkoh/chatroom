import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { HarnessHarnessSelect } from './HarnessHarnessSelect';
import { CAPABILITIES_REFRESH_HINT } from './select-empty-states';

describe('HarnessHarnessSelect', () => {
  it('shows an empty-state label when no harnesses are available', () => {
    render(<HarnessHarnessSelect harnesses={[]} value="pi-sdk" onValueChange={vi.fn()} />);

    expect(screen.getByRole('combobox')).toHaveTextContent('No harnesses available');
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveAttribute('title', CAPABILITIES_REFRESH_HINT);
  });

  it('renders harness options when available', () => {
    render(
      <HarnessHarnessSelect
        harnesses={[
          { name: 'pi-sdk', displayName: 'Pi (SDK)', agents: [], providers: [] },
          { name: 'cursor-sdk', displayName: 'Cursor (SDK)', agents: [], providers: [] },
        ]}
        value="pi-sdk"
        onValueChange={vi.fn()}
      />
    );

    expect(screen.getByRole('combobox')).toHaveTextContent('Pi (SDK)');
    expect(screen.getByRole('combobox')).not.toBeDisabled();
  });
});
