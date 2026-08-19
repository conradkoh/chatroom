export type LogHistoryQuery = {
  chatroomId: string;
  afterId?: number;
  beforeId?: number;
  source?: string;
  role?: string;
  harness?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
};
