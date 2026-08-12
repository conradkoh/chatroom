export type LogHistoryQuery = {
  afterId?: number;
  beforeId?: number;
  source?: string;
  limit?: number;
};
