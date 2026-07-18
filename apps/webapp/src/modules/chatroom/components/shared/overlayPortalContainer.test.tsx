import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  OverlayPortalContainerProvider,
  useOverlayPortalContainer,
} from './overlayPortalContainer';

function TestConsumer() {
  const container = useOverlayPortalContainer();
  return <div data-testid="container-value">{container ? 'has-container' : 'null'}</div>;
}

describe('OverlayPortalContainer', () => {
  it('returns null outside provider', () => {
    render(<TestConsumer />);
    expect(screen.getByTestId('container-value')).toHaveTextContent('null');
  });

  it('provides the container value inside provider', () => {
    const div = document.createElement('div');
    render(
      <OverlayPortalContainerProvider container={div}>
        <TestConsumer />
      </OverlayPortalContainerProvider>
    );
    expect(screen.getByTestId('container-value')).toHaveTextContent('has-container');
  });
});
