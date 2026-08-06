export type FileContentRequestStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface FileContentRequest {
  requestId: string;
  machineId: string;
  workingDir: string;
  filePath: string;
  status: FileContentRequestStatus;
}
