export type WorkspaceUploadPhase = 'uploading' | 'finalizing' | 'complete' | 'error';

export type WorkspaceUploadJob = {
  id: string;
  filePath: string;
  fileName: string;
  phase: WorkspaceUploadPhase;
  percent: number; // 0-100
  errorMessage?: string;
};

// fallow-ignore-next-line unused-export
export const UPLOAD_BYTE_PROGRESS_CAP = 75;
export const FINALIZING_PROGRESS = 90;
export const COMPLETE_PROGRESS = 100;
export const UPLOAD_COMPLETE_DISMISS_MS = 2000;
export const UPLOAD_ERROR_DISMISS_MS = 5000;

export function percentForUploadBytes(loaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(
    UPLOAD_BYTE_PROGRESS_CAP,
    Math.round((loaded / total) * UPLOAD_BYTE_PROGRESS_CAP)
  );
}

// fallow-ignore-next-line complexity
export function phaseLabel(phase: WorkspaceUploadPhase): string {
  switch (phase) {
    case 'uploading':
      return 'Uploading…';
    case 'finalizing':
      return 'Writing to workspace…';
    case 'complete':
      return 'Upload complete';
    case 'error':
      return 'Upload failed';
  }
}
