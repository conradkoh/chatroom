import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FileCopyActionsMenu } from './FileCopyActionsMenu';

const defaultProps = {
  relativePath: 'src/foo.ts',
  workingDir: '/workspace/project',
  content: 'file body',
  truncated: false,
  contentDisabled: false,
};

describe('FileCopyActionsMenu', () => {
  it('renders trigger button with copy icon', () => {
    render(<FileCopyActionsMenu {...defaultProps} />);
    expect(screen.getByRole('button', { name: /copy file/i })).toBeInTheDocument();
  });
});
