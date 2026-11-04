import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StorageUsageBar } from './StorageUsageBar';

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

function indicator(): Element {
  const element = document.querySelector('[data-slot="progress-indicator"]');
  if (!element) throw new Error('progress indicator not rendered');
  return element;
}

describe('StorageUsageBar', () => {
  it('uses the accent tone below 80% of the limit', () => {
    render(
      <StorageUsageBar usedBytes={100 * MB} fileCount={2} limitBytes={1 * GB} isDefault={false} />
    );

    expect(indicator().className).toContain('bg-chatroom-accent');
    expect(indicator().className).not.toContain('bg-chatroom-status-warning');
    expect(screen.getByTestId('storage-usage').textContent).toContain(
      '100 MB of 1 GB used · 2 files'
    );
    expect(screen.getByText('10%')).toBeInTheDocument();
  });

  it('uses the warning tone at exactly 80% of the limit', () => {
    render(<StorageUsageBar usedBytes={800 * MB} fileCount={4} limitBytes={1000 * MB} isDefault />);

    expect(indicator().className).toContain('bg-chatroom-status-warning');
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('uses the error tone above 100% of the limit', () => {
    render(
      <StorageUsageBar
        usedBytes={1200 * MB}
        fileCount={5}
        limitBytes={1000 * MB}
        isDefault={false}
      />
    );

    expect(indicator().className).toContain('bg-chatroom-status-error');
    expect(screen.getByText('120%')).toBeInTheDocument();
  });

  it('shows the capped marker and caption when the effective limit is lower', () => {
    render(
      <StorageUsageBar
        usedBytes={100 * MB}
        fileCount={1}
        limitBytes={1 * GB}
        effectiveLimitBytes={500 * MB}
        isDefault={false}
      />
    );

    expect(screen.getByTestId('storage-effective-marker')).toBeInTheDocument();
    expect(screen.getByText('Capped at 500 MB by your account limit.')).toBeInTheDocument();
  });

  it('does not show the capped marker when nothing caps the limit', () => {
    render(
      <StorageUsageBar usedBytes={100 * MB} fileCount={1} limitBytes={1 * GB} isDefault={false} />
    );

    expect(screen.queryByTestId('storage-effective-marker')).not.toBeInTheDocument();
  });

  it('shows 0% rather than NaN when the effective limit is zero', () => {
    render(<StorageUsageBar usedBytes={0} fileCount={0} limitBytes={0} isDefault={false} />);

    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.queryByText('NaN%')).not.toBeInTheDocument();
  });
});
