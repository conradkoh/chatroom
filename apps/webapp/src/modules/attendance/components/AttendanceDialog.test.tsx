import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttendanceDialog } from './AttendanceDialog';

const mocks = vi.hoisted(() => ({
  recordAttendance: vi.fn(),
  deleteAttendanceRecord: vi.fn(),
}));

// Data port: the Convex mutations, keyed by their generated function names.
vi.mock('convex-helpers/react/sessions', async () => {
  const { getFunctionName } = await import('convex/server');
  return {
    useSessionMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === 'attendance:recordAttendance') return mocks.recordAttendance;
      if (name === 'attendance:deleteAttendanceRecord') return mocks.deleteAttendanceRecord;
      throw new Error(`Unexpected mutation in AttendanceDialog test: ${name}`);
    },
  };
});

// Data port: the signed-in user. Anonymous here, so the name field is always shown.
vi.mock('@/modules/auth/AuthProvider', () => ({
  useCurrentUser: () => undefined,
}));

type DialogProps = ComponentProps<typeof AttendanceDialog>;

function renderDialog(overrides: Partial<DialogProps> = {}) {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  render(
    <AttendanceDialog
      isOpen
      onClose={onClose}
      personName=""
      attendanceRecords={[]}
      isManuallyJoined={false}
      onSuccess={onSuccess}
      {...overrides}
    />
  );
  return { onClose, onSuccess };
}

// Build with the fields of the `attendanceRecords` table in services/backend/convex/schema.ts.
const aliceRecord = {
  _id: 'record-1' as Id<'attendanceRecords'>,
  _creationTime: 0,
  attendanceKey: 'key-1',
  timestamp: 0,
  name: 'Alice',
  status: 'attending',
} as Doc<'attendanceRecords'>;

describe('AttendanceDialog', () => {
  beforeEach(() => {
    mocks.recordAttendance.mockReset();
    mocks.deleteAttendanceRecord.mockReset();
  });

  it('shows the name requirement under the name field and clears it on edit', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your name');
    expect(mocks.recordAttendance).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Your Name'), 'A');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the dialog open and shows the save failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.recordAttendance.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    const { onClose, onSuccess } = renderDialog({ personName: 'Alice' });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to record attendance. Please try again.'
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('dismisses the save failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.recordAttendance.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    renderDialog({ personName: 'Alice' });

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes without a success message after a saved response', async () => {
    mocks.recordAttendance.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { onClose, onSuccess } = renderDialog({ personName: 'Alice' });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the delete failure and keeps the dialog open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.deleteAttendanceRecord.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    const { onClose } = renderDialog({ personName: 'Alice', attendanceRecords: [aliceRecord] });

    await user.click(screen.getByRole('button', { name: 'Delete this response' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to delete attendance record. Please try again.'
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
