export type EventStreamQuery = {
  chatroomId: string;
  afterId?: number | undefined;
  beforeId?: number | undefined;
  type?: string | undefined;
  fromTimestamp?: number | undefined;
  toTimestamp?: number | undefined;
  limit?: number | undefined;
};
