export type FileWriteRequestStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface FileWriteRequest {
  requestId: string;
  machineId: string;
  workingDir: string;
  filePath: string;
  content: string;
  status: FileWriteRequestStatus;
}
