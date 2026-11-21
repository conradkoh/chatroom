import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Doc } from '@workspace/backend/convex/_generated/dataModel';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttendanceDialog } from './AttendanceDialog';

const mocks = vi.hoisted(() => ({
  currentUser: undefined as unknown,
  recordAttendance: vi.fn(),
  deleteAttendanceRecord: vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    attendance: {
      recordAttendance: 'attendance:recordAttendance',
      deleteAttendanceRecord: 'attendance:deleteAttendanceRecord',
    },
  },
}));
vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (ref: string) =>
    ({
      'attendance:recordAttendance': mocks.recordAttendance,
      'attendance:deleteAttendanceRecord': mocks.deleteAttendanceRecord,
    })[ref],
}));
vi.mock('@/modules/auth/AuthProvider', () => ({
  useCurrentUser: () => mocks.currentUser,
}));

// Anonymous visitor: the name input is shown and respondAs is 'other'.
const anonymousRecord = {
  _id: 'record-1',
  attendanceKey: 'default-attendance',
  timestamp: 0,
  name: 'Ada',
  status: 'attending',
  remarks: '',
} as unknown as Doc<'attendanceRecords'>;

type DialogProps = ComponentProps<typeof AttendanceDialog>;

function renderDialog(overrides: Partial<DialogProps> = {}) {
  const onClose = vi.fn();
  render(
    <AttendanceDialog
      isOpen
      onClose={onClose}
      personName=""
      attendanceRecords={[]}
      isManuallyJoined={false}
      {...overrides}
    />
  );
  return { onClose };
}

beforeEach(() => {
  mocks.currentUser = undefined;
  mocks.recordAttendance.mockReset().mockResolvedValue(undefined);
  mocks.deleteAttendanceRecord.mockReset().mockResolvedValue(undefined);
});

describe('AttendanceDialog name validation feedback', () => {
  it('shows the name message with aria-invalid when Save is pressed with an empty name', async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Please enter your name');

    const input = screen.getByLabelText('Your Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'name-error');

    expect(mocks.recordAttendance).not.toHaveBeenCalled();
    expect(screen.getByText('Record Attendance')).toBeInTheDocument();
  });

  it('clears the name message as soon as the name is typed', async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Your Name'), 'A');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Your Name')).not.toHaveAttribute('aria-invalid');
  });
});

describe('AttendanceDialog record feedback', () => {
  it('records anonymous attendance, closes, and shows no message', async () => {
    const { onClose } = renderDialog();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Your Name'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.recordAttendance).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ada', self: false })
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the dialog open and the entered name when recording fails', async () => {
    mocks.recordAttendance.mockRejectedValueOnce(new Error('network'));
    const { onClose } = renderDialog();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Your Name'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to record attendance. Please try again.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Your Name')).toHaveValue('Ada');

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(alert.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('clears the action message when the next Save starts', async () => {
    mocks.recordAttendance
      .mockRejectedValueOnce(new Error('network'))
      .mockReturnValueOnce(new Promise(() => {}));
    renderDialog();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Your Name'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the action message when Cancel is pressed', async () => {
    mocks.recordAttendance.mockRejectedValueOnce(new Error('network'));
    const { onClose } = renderDialog();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Your Name'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('AttendanceDialog delete feedback', () => {
  it('shows the delete failure above the footer and keeps the dialog open', async () => {
    mocks.deleteAttendanceRecord.mockRejectedValueOnce(new Error('boom'));
    const { onClose } = renderDialog({ personName: 'Ada', attendanceRecords: [anonymousRecord] });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Delete this response' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to delete attendance record. Please try again.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Your Name')).toHaveValue('Ada');
  });

  it('closes with no message after a successful delete', async () => {
    const { onClose } = renderDialog({ personName: 'Ada', attendanceRecords: [anonymousRecord] });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Delete this response' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
