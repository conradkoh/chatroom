export type FileTreeRequestStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface FileTreeRequest {
  requestId: string;
  machineId: string;
  workingDir: string;
  force: boolean;
  status: FileTreeRequestStatus;
}
