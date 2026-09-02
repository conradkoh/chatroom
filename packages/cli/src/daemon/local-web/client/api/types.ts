export type AppErrorCode = 'validation_error' | 'not_found' | 'internal_error' | 'unauthorized';

export type AppError = {
  code: AppErrorCode;
  message: string;
  details?: unknown | undefined;
};

export type SocketAckSuccess<T> = { ok: true; data: T };
export type SocketAckFailure = { ok: false; error: AppError };
export type SocketAck<T> = SocketAckSuccess<T> | SocketAckFailure;

export type LocalWebHealth = {
  status: 'ok';
  service: 'v2-local-web';
  port: number;
};

export type HealthGetAck = SocketAck<LocalWebHealth>;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogMetadata = { chatroomId?: string | undefined; role?: string | undefined; pid?: number | undefined; harness?: string | undefined };
export type LogLine = {
  id?: number | undefined;
  timestamp: number;
  level: LogLevel;
  source: string;
  stream?: 'stdout' | 'stderr' | undefined;
  message: string;
  metadata?: LogMetadata | undefined;
};
export type LogHistoryInput = {
  chatroomId: string;
  afterId?: number | undefined;
  beforeId?: number | undefined;
  source?: string | undefined;
  role?: string | undefined;
  harness?: string | undefined;
  fromTimestamp?: number | undefined;
  toTimestamp?: number | undefined;
  limit?: number | undefined;
};
export type ChatroomListItem = { id: string; displayName: string };
export type ChatroomsListResult = { chatrooms: ChatroomListItem[] };
export type ChatroomsListAck = SocketAck<ChatroomsListResult>;
export type LogDimensionsResult = { roles: string[]; harnesses: string[] };
export type LogsDimensionsAck = SocketAck<LogDimensionsResult>;
export type LogHistoryResult = { entries: LogLine[] };
export type LogSourcesResult = { sources: string[] };
export type LogsHistoryAck = SocketAck<LogHistoryResult>;
export type LogsSourcesAck = SocketAck<LogSourcesResult>;
export type EventStreamEntry = {
  id: number;
  timestamp: number;
  type: string;
  payload: Record<string, unknown>;
};
export type EventStreamHistoryInput = {
  chatroomId: string;
  afterId?: number | undefined;
  beforeId?: number | undefined;
  type?: string | undefined;
  fromTimestamp?: number | undefined;
  toTimestamp?: number | undefined;
  limit?: number | undefined;
};
export type EventStreamHistoryResult = { entries: EventStreamEntry[] };
export type EventStreamHistoryAck = SocketAck<EventStreamHistoryResult>;
