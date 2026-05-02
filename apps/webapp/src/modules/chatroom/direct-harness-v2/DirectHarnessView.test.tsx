import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DirectHarnessView } from './DirectHarnessView';

describe('DirectHarnessView', () => {
  it('renders the workspace placeholder when no workspace is selected', () => {
    render(<DirectHarnessView chatroomId={'fakeid' as never} />);
    expect(screen.getByText(/select a workspace/i)).toBeInTheDocument();
  });
});
