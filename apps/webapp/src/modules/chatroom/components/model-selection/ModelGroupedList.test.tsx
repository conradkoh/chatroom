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

const TAGGED_GROUPS: ModelGroup[] = [
  {
    providerKey: 'openai',
    providerLabel: 'OpenAI',
    options: [
      { value: 'openai/gpt-5.6-luna[thinking=low]', label: 'Gpt 5.6 Luna' },
      { value: 'openai/gpt-5.6-luna[thinking=high]', label: 'Gpt 5.6 Luna' },
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

  it('filters tagged models in select mode', () => {
    const onValueChange = vi.fn();
    const onClose = vi.fn();
    render(
      <ModelGroupedList
        mode="select"
        groups={TAGGED_GROUPS}
        searchTerm="luna low"
        value=""
        onValueChange={onValueChange}
        onClose={onClose}
      />
    );
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('option'));
    expect(onValueChange).toHaveBeenCalledWith('openai/gpt-5.6-luna[thinking=low]');
    expect(onClose).toHaveBeenCalled();
  });

  it('filters tagged models in visibility-toggle mode', () => {
    const onModelToggle = vi.fn();
    render(
      <ModelGroupedList
        mode="visibility-toggle"
        groups={TAGGED_GROUPS}
        searchTerm="luna low"
        hiddenModels={[]}
        hiddenProviders={[]}
        onModelToggle={onModelToggle}
        onProviderToggle={vi.fn()}
      />
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onModelToggle).toHaveBeenCalledWith('openai/gpt-5.6-luna[thinking=low]');
  });
});
