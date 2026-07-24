import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnhancerDiffPanel } from './EnhancerDiffPanel';

const { buildEnhancerTextDiffMock } = vi.hoisted(() => ({
  buildEnhancerTextDiffMock: vi.fn(() => ({
    unified: [
      { type: 'deletion' as const, content: 'old' },
      { type: 'addition' as const, content: 'new' },
    ],
    split: {
      before: {
        label: 'Before',
        lines: [{ type: 'deletion' as const, content: 'old', lineNumber: 1 }],
      },
      after: {
        label: 'After',
        lines: [{ type: 'addition' as const, content: 'new', lineNumber: 1 }],
      },
    },
  })),
}));

let mockViewMode: 'split' | 'unified' = 'split';

vi.mock('../utils/buildEnhancerTextDiff', () => ({
  buildEnhancerTextDiff: buildEnhancerTextDiffMock,
}));

vi.mock('../hooks/useEnhancerDiffViewMode', () => ({
  useEnhancerDiffViewMode: () => ({
    viewMode: mockViewMode,
    setViewMode: vi.fn(),
    resetViewMode: vi.fn(),
    isDesktop: true,
  }),
}));

describe('EnhancerDiffPanel', () => {
  it('does not compute diff when closed', () => {
    buildEnhancerTextDiffMock.mockClear();
    mockViewMode = 'split';

    render(
      <EnhancerDiffPanel
        open={false}
        onOpenChange={vi.fn()}
        originalContent="old"
        enhancedContent="new"
      />
    );

    expect(buildEnhancerTextDiffMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('enhancer-split-diff-view')).not.toBeInTheDocument();
  });

  it('computes and renders split diff when open', () => {
    buildEnhancerTextDiffMock.mockClear();
    mockViewMode = 'split';

    render(
      <EnhancerDiffPanel open onOpenChange={vi.fn()} originalContent="old" enhancedContent="new" />
    );

    expect(buildEnhancerTextDiffMock).toHaveBeenCalledWith('old', 'new');
    expect(screen.getByTestId('enhancer-split-diff-view')).toBeInTheDocument();
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('renders unified diff when view mode is unified', () => {
    buildEnhancerTextDiffMock.mockClear();
    mockViewMode = 'unified';

    render(
      <EnhancerDiffPanel open onOpenChange={vi.fn()} originalContent="old" enhancedContent="new" />
    );

    expect(screen.getByTestId('enhancer-unified-diff-view')).toBeInTheDocument();
    expect(screen.queryByTestId('enhancer-split-diff-view')).not.toBeInTheDocument();
  });
});
