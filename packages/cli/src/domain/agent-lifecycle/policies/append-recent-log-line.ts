import type { TurnEndSlot } from '../../../v2/domain/entities/native-turn.js';

const RECENT_LOG_LINE_CAP = 100;

export function appendRecentLogLine(slot: TurnEndSlot, line: string): void {
  if (!slot.recentLogLines) {
    slot.recentLogLines = [];
  }
  slot.recentLogLines.push(line);
  if (slot.recentLogLines.length > RECENT_LOG_LINE_CAP) {
    slot.recentLogLines.shift();
  }
}
