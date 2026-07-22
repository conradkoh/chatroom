export type ProcessStatus = 'pending' | 'starting' | 'running' | 'stopped' | 'crashed';

export type ManagedProcessId = 'convex' | 'webapp' | 'daemon';

export type HealthStatus = 'unknown' | 'checking' | 'healthy' | 'unhealthy';

export type ProcessInfo = {
  id: ManagedProcessId;
  name: string;
  status: ProcessStatus;
  pid: number | null;
  startedAt: number | null;
  exitedAt: number | null;
  exitCode: number | null;
  health: HealthStatus;
  healthDetail: string | null;
};

export type LogStream = 'stdout' | 'stderr';

export type LogLine = {
  processId: ManagedProcessId;
  stream: LogStream;
  text: string;
  timestamp: number;
};

export type LocalConfigSnapshot = {
  managerPort: number;
  convexPort: number;
  webappPort: number;
  convexUrl: string;
  webappUrl: string;
};

export type ServerMessage =
  | {
      type: 'snapshot';
      processes: ProcessInfo[];
      logs: Record<ManagedProcessId, LogLine[]>;
      config: LocalConfigSnapshot;
    }
  | { type: 'process-update'; process: ProcessInfo }
  | { type: 'log'; line: LogLine }
  | { type: 'config'; config: LocalConfigSnapshot };

export type ClientMessage = { type: 'restart'; processId: ManagedProcessId };
