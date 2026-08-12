import { z } from 'zod';

import type { HarnessHistoryQuery } from '../../domain/entities/harness-history-query.js';
import type { LogHistoryQuery } from '../../domain/entities/log-history-query.js';

export const harnessHistoryInputSchema = z.object({
  harness: z.string().optional(),
  limit: z.number().int().positive().max(5000).optional(),
}) satisfies z.ZodType<HarnessHistoryQuery>;
export const logHistoryInputSchema = z.object({
  afterId: z.number().int().nonnegative().optional(), beforeId: z.number().int().positive().optional(),
  source: z.string().optional(), limit: z.number().int().positive().max(1000).optional(),
}) satisfies z.ZodType<LogHistoryQuery>;
export const logSourcesInputSchema = z.object({ limit: z.number().int().positive().max(1000).optional() });
