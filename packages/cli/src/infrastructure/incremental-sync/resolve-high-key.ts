/**
 * Resolve the next exclusive cursor from a delta page.
 */

import type { MessageBuffer } from './message-buffer.js';
import type { IncrementalFeedDef, StreamKey } from './types.js';

// fallow-ignore-next-line complexity
export function resolveHighKey<TItem>(
  def: IncrementalFeedDef<TItem, unknown>,
  buffer: MessageBuffer<TItem>,
  page: { items: readonly TItem[]; highKey: StreamKey | null }
): StreamKey | null {
  if (page.highKey !== null) return page.highKey;
  const fromItems = buffer.highKeyOf(page.items);
  if (fromItems !== null) return fromItems;
  if (def.itemToKey && page.items.length > 0) {
    let high: StreamKey | null = null;
    for (const item of page.items) {
      const key = def.itemToKey(item);
      if (high === null || key > high) high = key;
    }
    return high;
  }
  return null;
}
