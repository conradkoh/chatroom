import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceUploadProgressList } from './WorkspaceUploadProgressList';
import { useWorkspaceUploadJobs } from '../hooks/useWorkspaceUploadJobs';

const mockUploadFile = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useWorkspaceFileUpload', () => ({
  useWorkspaceFileUpload: () => ({ uploadFile: mockUploadFile }),
}));

type StartUpload = (filePath: string, file: File) => Promise<void>;
type StartUploadRef = { current: StartUpload | null };

// Mirrors the explorer's configuration: failed rows persist until dismissed.
function UploadRowsHarness({ startRef }: { startRef: StartUploadRef }) {
  const { jobs, startUpload, dismissJob } = useWorkspaceUploadJobs({
    machineId: 'm',
    workingDir: '/w',
    errorDismissMs: false,
  });
  // Expose the upload starter to the test without an effect that passes data upward.
  startRef.current = startUpload;
  return <WorkspaceUploadProgressList jobs={jobs} onDismiss={dismissJob} />;
}

describe('explorer upload error rows', () => {
  const startRef: StartUploadRef = { current: null };

  beforeEach(() => {
    vi.useFakeTimers();
    mockUploadFile.mockReset();
    mockUploadFile.mockRejectedValue(new Error('Disk full'));
    startRef.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a failed upload as one error row past the auto-dismiss window, with no alert', async () => {
    render(<UploadRowsHarness startRef={startRef} />);
    await act(async () => {
      await startRef.current?.('docs/a.zip', new File(['x'], 'a.zip'));
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getAllByText('Disk full')).toHaveLength(1);
    expect(screen.getByText('Disk full')).toHaveClass('text-chatroom-status-error');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('removes the failed row when its Dismiss control is pressed', async () => {
    render(<UploadRowsHarness startRef={startRef} />);
    await act(async () => {
      await startRef.current?.('docs/a.zip', new File(['x'], 'a.zip'));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Disk full')).toBeNull();
  });
});
