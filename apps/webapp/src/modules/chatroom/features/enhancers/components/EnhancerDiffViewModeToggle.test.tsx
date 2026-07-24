import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnhancerDiffViewModeToggle } from './EnhancerDiffViewModeToggle';

describe('EnhancerDiffViewModeToggle', () => {
  it('calls onViewModeChange for split and unified', () => {
    const onViewModeChange = vi.fn();

    render(<EnhancerDiffViewModeToggle viewMode="unified" onViewModeChange={onViewModeChange} />);

    fireEvent.click(screen.getByTestId('enhancer-diff-view-split'));
    expect(onViewModeChange).toHaveBeenCalledWith('split');

    fireEvent.click(screen.getByTestId('enhancer-diff-view-unified'));
    expect(onViewModeChange).toHaveBeenCalledWith('unified');
  });
});
