export type ProcessStatus = 'starting' | 'running' | 'stopped' | 'crashed';

export type ManagedProcessId = 'convex' | 'webapp' | 'daemon';

export type ProcessInfo = {
  id: ManagedProcessId;
  name: string;
  status: ProcessStatus;
  pid: number | null;
  startedAt: number | null;
  exitedAt: number | null;
  exitCode: number | null;
};

export type LogStream = 'stdout' | 'stderr';

export type LogLine = {
  processId: ManagedProcessId;
  stream: LogStream;
  text: string;
  timestamp: number;
};

export type ServerMessage =
  | { type: 'snapshot'; processes: ProcessInfo[]; logs: Record<ManagedProcessId, LogLine[]> }
  | { type: 'process-update'; process: ProcessInfo }
  | { type: 'log'; line: LogLine };

export type ClientMessage = { type: 'restart'; processId: ManagedProcessId };
