/** Commands that control the lifecycle of one or more agents. */
export type LifecycleCommand =
  | {
      type: 'start';
      chatroomId: string;
      role: string;
    }
  | {
      type: 'stop';
      chatroomId: string;
      role: string;
      pid?: number;
    }
  | {
      type: 'restart';
      chatroomId: string;
      role: string;
    };
