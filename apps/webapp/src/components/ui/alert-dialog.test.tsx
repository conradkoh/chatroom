import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogAction,
} from './alert-dialog';

describe('AlertDialog', () => {
  it('renders content when open', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Confirm</AlertDialogTitle>
          <AlertDialogDescription>Are you sure?</AlertDialogDescription>
          <AlertDialogAction>Delete</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    );
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('rounded-none');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-chatroom-status-error');
    expect(screen.getByRole('alertdialog')).toHaveClass('rounded-none', 'bg-chatroom-bg-primary');
  });
});
