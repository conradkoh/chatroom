/** Activity status values projected for one agent role in a chatroom. */
export type ChatroomAgentActivityStatusValue =
  | 'offline'
  | 'starting'
  | 'waiting'
  | 'working'
  | 'stopping'
  | 'error';

/** Activity status projected for one agent role in a chatroom. */
export type ChatroomAgentActivityStatus = {
  status: ChatroomAgentActivityStatusValue;
};

/** Shared semantic variants used by per-agent and aggregate status displays. */
export type ChatroomAgentActivityVariant =
  | 'offline'
  | 'error'
  | 'transitioning'
  | 'ready'
  | 'working';

/** Map a projected agent status to its semantic UI variant. */
export function deriveChatroomAgentActivityVariant(
  status: ChatroomAgentActivityStatusValue
): ChatroomAgentActivityVariant {
  switch (status) {
    case 'starting':
    case 'stopping':
      return 'transitioning';
    case 'waiting':
      return 'ready';
    case 'working':
      return 'working';
    case 'error':
      return 'error';
    case 'offline':
      return 'offline';
  }
}

/** Whether a projected status represents an available agent process. */
export function isChatroomAgentActivityOnline(status: ChatroomAgentActivityStatusValue): boolean {
  return status !== 'offline' && status !== 'error';
}
