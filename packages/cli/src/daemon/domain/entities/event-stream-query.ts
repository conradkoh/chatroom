export type EventStreamQuery = {
  chatroomId: string;
  afterId?: number;
  beforeId?: number;
  type?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
};
