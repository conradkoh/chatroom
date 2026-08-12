export type LogHistoryQuery = {
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
