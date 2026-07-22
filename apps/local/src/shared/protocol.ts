export type ProcessStatus = 'pending' | 'starting' | 'running' | 'stopped' | 'crashed' | 'skipped';

export type ManagedProcessId = 'convex' | 'webapp' | 'daemon';

export type HealthStatus = 'unknown' | 'checking' | 'healthy' | 'unhealthy';

export type SessionPhase = 'idle' | 'starting' | 'running' | 'stopping' | 'failed';

export type RepoUpdateStatus = {
  status: 'idle' | 'checking' | 'available' | 'up-to-date' | 'updating' | 'error';
  localVersion: string | null;
  remoteVersion: string | null;
  error: string | null;
};

export type ConvexBackupEntry = {
  id: string;
  filename: string;
  createdAt: number;
  sizeBytes: number;
};

export type ConvexBackupStatus = {
  status: 'idle' | 'listing' | 'creating' | 'restoring' | 'deleting' | 'error';
  backups: ConvexBackupEntry[];
  error: string | null;
};

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
      repoUpdate: RepoUpdateStatus;
      backup: ConvexBackupStatus;
    }
  | { type: 'phase'; phase: SessionPhase }
  | { type: 'process-update'; process: ProcessInfo }
  | { type: 'log'; line: LogLine }
  | { type: 'logs-clear'; processId: ManagedProcessId }
  | { type: 'runtime-config'; runtime: RuntimeConfig | null }
  | { type: 'repo-update'; update: RepoUpdateStatus }
  | { type: 'convex-backup'; backup: ConvexBackupStatus };

export type ClientMessage =
  | { type: 'start'; config: RuntimeConfig }
  | { type: 'stop' }
  | { type: 'restart'; processId: ManagedProcessId }
  | { type: 'check-repo-update' }
  | { type: 'apply-repo-update' }
  | { type: 'list-convex-backups' }
  | { type: 'create-convex-backup' }
  | { type: 'restore-convex-backup'; backupId: string }
  | { type: 'delete-convex-backup'; backupId: string };
