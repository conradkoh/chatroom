import { describe, expect, it } from 'vitest';

import {
  COMPLETE_PROGRESS,
  FINALIZING_PROGRESS,
  UPLOAD_BYTE_PROGRESS_CAP,
  percentForUploadBytes,
  phaseLabel,
} from './workspaceUploadProgress';

describe('percentForUploadBytes', () => {
  it('returns 0 when total is not positive', () => {
    expect(percentForUploadBytes(0, 0)).toBe(0);
    expect(percentForUploadBytes(50, -1)).toBe(0);
  });

  it('maps loaded/total to 0..75', () => {
    expect(percentForUploadBytes(0, 100)).toBe(0);
    expect(percentForUploadBytes(50, 100)).toBe(38);
    expect(percentForUploadBytes(100, 100)).toBe(75);
  });

  it('caps at UPLOAD_BYTE_PROGRESS_CAP', () => {
    expect(percentForUploadBytes(100, 100)).toBe(UPLOAD_BYTE_PROGRESS_CAP);
    expect(percentForUploadBytes(200, 100)).toBe(UPLOAD_BYTE_PROGRESS_CAP);
  });
});

describe('phaseLabel', () => {
  it('maps each phase to a user-visible label', () => {
    expect(phaseLabel('uploading')).toBe('Uploading…');
    expect(phaseLabel('finalizing')).toBe('Writing to workspace…');
    expect(phaseLabel('complete')).toBe('Upload complete');
    expect(phaseLabel('error')).toBe('Upload failed');
  });

  it('keeps phase progress constants consistent', () => {
    expect(UPLOAD_BYTE_PROGRESS_CAP).toBeLessThan(FINALIZING_PROGRESS);
    expect(FINALIZING_PROGRESS).toBeLessThan(COMPLETE_PROGRESS);
    expect(COMPLETE_PROGRESS).toBe(100);
  });
});
