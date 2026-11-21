import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceUploadProgressList } from './WorkspaceUploadProgressList';
import type { WorkspaceUploadJob } from '../utils/workspaceUploadProgress';

function job(overrides: Partial<WorkspaceUploadJob>): WorkspaceUploadJob {
  return {
    id: 'job-1',
    filePath: 'docs/notes.md',
    fileName: 'notes.md',
    phase: 'uploading',
    percent: 10,
    ...overrides,
  };
}

describe('WorkspaceUploadProgressList', () => {
  it('returns null when there are no jobs', () => {
    const { container } = render(<WorkspaceUploadProgressList jobs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a row for each job with name and phase label', () => {
    const jobs: WorkspaceUploadJob[] = [
      job({ id: 'a', filePath: 'a.txt', fileName: 'a.txt' }),
      job({ id: 'b', filePath: 'src/b.ts', fileName: 'b.ts' }),
    ];
    render(<WorkspaceUploadProgressList jobs={jobs} />);

    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('b.ts')).toBeInTheDocument();
    expect(screen.getAllByText('Uploading…')).toHaveLength(2);
  });

  it('shows the uploading phase label with byte percent', () => {
    render(<WorkspaceUploadProgressList jobs={[job({ phase: 'uploading', percent: 42 })]} />);
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('shows the finalizing phase label', () => {
    render(<WorkspaceUploadProgressList jobs={[job({ phase: 'finalizing', percent: 90 })]} />);
    expect(screen.getByText('Writing to workspace…')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
  });

  it('shows the complete state', () => {
    render(<WorkspaceUploadProgressList jobs={[job({ phase: 'complete', percent: 100 })]} />);
    expect(screen.getByText('Upload complete')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows the error message on failure', () => {
    render(
      <WorkspaceUploadProgressList
        jobs={[job({ phase: 'error', percent: 90, errorMessage: 'Disk full' })]}
      />
    );
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByText('Disk full')).toBeInTheDocument();
  });

  it('shows the error message in the error text colour', () => {
    render(
      <WorkspaceUploadProgressList jobs={[job({ phase: 'error', errorMessage: 'Disk full' })]} />
    );
    expect(screen.getByText('Disk full')).toHaveClass('text-chatroom-status-error');
  });

  it('renders a Dismiss control on error rows that calls onDismiss with the job id', () => {
    const onDismiss = vi.fn();
    render(
      <WorkspaceUploadProgressList
        jobs={[job({ id: 'job-1', phase: 'error', errorMessage: 'Disk full' })]}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledWith('job-1');
  });

  it('renders no Dismiss control when onDismiss is not passed', () => {
    render(
      <WorkspaceUploadProgressList jobs={[job({ phase: 'error', errorMessage: 'Disk full' })]} />
    );
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('renders no Dismiss control on rows that are not in error', () => {
    render(
      <WorkspaceUploadProgressList jobs={[job({ phase: 'uploading' })]} onDismiss={vi.fn()} />
    );
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });
});
