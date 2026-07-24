import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModelGroupedList } from './ModelGroupedList';
import type { ModelGroup } from './types';

const GROUPS: ModelGroup[] = [
  {
    providerKey: 'openai',
    providerLabel: 'OpenAI',
    options: [
      { value: 'openai/gpt-4o', label: 'GPT-4o' },
      { value: 'openai/gpt-4-turbo', label: 'GPT-4 Turbo' },
    ],
  },
];

describe('ModelGroupedList', () => {
  it('renders select mode options', () => {
    const onValueChange = vi.fn();
    const onClose = vi.fn();

    render(
      <ModelGroupedList
        mode="select"
        groups={GROUPS}
        value=""
        onValueChange={onValueChange}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByText('GPT-4o'));
    expect(onValueChange).toHaveBeenCalledWith('openai/gpt-4o');
    expect(onClose).toHaveBeenCalled();
  });

  it('renders visibility-toggle rows and toggles models', () => {
    const onModelToggle = vi.fn();

    render(
      <ModelGroupedList
        mode="visibility-toggle"
        groups={GROUPS}
        hiddenModels={[]}
        hiddenProviders={[]}
        onModelToggle={onModelToggle}
        onProviderToggle={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('GPT-4 Turbo'));
    expect(onModelToggle).toHaveBeenCalledWith('openai/gpt-4-turbo');
    expect(screen.getByRole('button', { name: 'Hide All' })).toBeInTheDocument();
  });
});
