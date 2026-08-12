import { z } from 'zod';

import type { HarnessHistoryQuery } from '../../domain/entities/harness-history-query.js';

export const harnessHistoryInputSchema = z.object({
  harness: z.string().optional(),
  limit: z.number().int().positive().max(5000).optional(),
}) satisfies z.ZodType<HarnessHistoryQuery>;
