import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EditorSplitLayout } from './EditorSplitLayout';

describe('EditorSplitLayout', () => {
  it('renders primary content when no secondary provided', () => {
    render(
      <EditorSplitLayout
        primary={<div data-testid="primary">Primary</div>}
        secondary={null}
        secondaryTabBar={null}
      />
    );
    expect(screen.getByTestId('primary')).toBeInTheDocument();
    expect(screen.queryByTestId('editor-split-layout')).not.toBeInTheDocument();
  });

  it('renders split layout with secondary content', () => {
    render(
      <EditorSplitLayout
        primary={<div data-testid="primary">Primary</div>}
        secondary={<div data-testid="secondary">Secondary</div>}
        secondaryTabBar={<div data-testid="secondary-tab-bar">Tab Bar</div>}
      />
    );
    expect(screen.getByTestId('primary')).toBeInTheDocument();
    expect(screen.getByTestId('secondary')).toBeInTheDocument();
    expect(screen.getByTestId('secondary-tab-bar')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Secondary')).toBeInTheDocument();
  });
});
