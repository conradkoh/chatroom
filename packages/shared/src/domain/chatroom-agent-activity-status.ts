/** Activity status projected for one agent role in a chatroom. */
export type ChatroomAgentActivityStatus = {
  status: 'offline' | 'starting' | 'waiting' | 'working' | 'stopping' | 'error';
};
