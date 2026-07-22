export type ProcessStatus = 'pending' | 'starting' | 'running' | 'stopped' | 'crashed' | 'skipped';

export type ManagedProcessId = 'convex' | 'webapp' | 'daemon';

export type HealthStatus = 'unknown' | 'checking' | 'healthy' | 'unhealthy';

export type SessionPhase = 'idle' | 'starting' | 'running' | 'stopping';

export type ConvexBackendMode = 'local' | 'hosted';

export type RuntimeConfig = {
  webappPort: number;
  convexBackendMode: ConvexBackendMode;
  convexPort: number;
  convexUrl: string;
};

export type RuntimeConfigDefaults = RuntimeConfig & {
  managerPort: number;
  hostedConvexUrlFromEnv: string | null;
  webappPortFromEnv: number | null;
};

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

export type ServerMessage =
  | {
      type: 'snapshot';
      phase: SessionPhase;
      processes: ProcessInfo[];
      logs: Record<ManagedProcessId, LogLine[]>;
      defaults: RuntimeConfigDefaults | null;
      runtime: RuntimeConfig | null;
    }
  | { type: 'phase'; phase: SessionPhase }
  | { type: 'process-update'; process: ProcessInfo }
  | { type: 'log'; line: LogLine }
  | { type: 'runtime-config'; runtime: RuntimeConfig | null };

export type ClientMessage =
  | { type: 'start'; config: RuntimeConfig }
  | { type: 'stop' }
  | { type: 'restart'; processId: ManagedProcessId };
