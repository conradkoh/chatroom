export type AppErrorCode = 'validation_error' | 'not_found' | 'internal_error' | 'unauthorized';

export type AppError = {
  code: AppErrorCode;
  message: string;
  details?: unknown;
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
export type LogMetadata = { chatroomId?: string; role?: string; pid?: number; harness?: string };
export type LogLine = {
  id?: number;
  timestamp: number;
  level: LogLevel;
  source: string;
  stream?: 'stdout' | 'stderr';
  message: string;
  metadata?: LogMetadata;
};
export type LogHistoryInput = {
  afterId?: number;
  beforeId?: number;
  source?: string;
  chatroomId?: string;
  role?: string;
  harness?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
};
export type ChatroomListItem = { id: string; displayName: string };
export type ChatroomsListResult = { chatrooms: ChatroomListItem[] };
export type ChatroomsListAck = SocketAck<ChatroomsListResult>;
export type LogDimensionsResult = { chatroomIds: string[]; roles: string[]; harnesses: string[] };
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
  afterId?: number;
  beforeId?: number;
  type?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
};
export type EventStreamHistoryResult = { entries: EventStreamEntry[] };
export type EventStreamHistoryAck = SocketAck<EventStreamHistoryResult>;
