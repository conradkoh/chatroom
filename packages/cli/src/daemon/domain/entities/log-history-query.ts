export type LogHistoryQuery = {
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
