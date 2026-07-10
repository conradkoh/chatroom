export type RecencyBucket = 'lastDay' | 'lastWeek' | 'lastMonth' | 'older';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * MS_PER_DAY;
const MONTH_MS = 30 * MS_PER_DAY;

function getChatroomActivityTime(chatroom: {
  lastActivityAt?: number;
  _creationTime: number;
}): number {
  return chatroom.lastActivityAt ?? chatroom._creationTime;
}

/** Local calendar start of yesterday (00:00:00). */
function getStartOfYesterday(now = Date.now()): number {
  const date = new Date(now);
  date.setDate(date.getDate() - 1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getRecencyBucket(activityTime: number, now = Date.now()): RecencyBucket {
  const startOfYesterday = getStartOfYesterday(now);
  if (activityTime >= startOfYesterday) return 'lastDay';

  const ageMs = now - activityTime;
  if (ageMs <= WEEK_MS) return 'lastWeek';
  if (ageMs <= MONTH_MS) return 'lastMonth';
  return 'older';
}

export function groupChatroomsByRecency<
  T extends { lastActivityAt?: number; _creationTime: number },
>(chatrooms: T[], now = Date.now()): Record<RecencyBucket, T[]> {
  const groups: Record<RecencyBucket, T[]> = {
    lastDay: [],
    lastWeek: [],
    lastMonth: [],
    older: [],
  };

  const sorted = [...chatrooms].sort((a, b) => {
    const aTime = getChatroomActivityTime(a);
    const bTime = getChatroomActivityTime(b);
    return bTime - aTime;
  });

  for (const chatroom of sorted) {
    const bucket = getRecencyBucket(getChatroomActivityTime(chatroom), now);
    groups[bucket].push(chatroom);
  }

  return groups;
}
