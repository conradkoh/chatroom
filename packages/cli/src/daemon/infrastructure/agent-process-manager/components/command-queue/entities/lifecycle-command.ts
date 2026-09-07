/** Commands that control the lifecycle of one or more agents. */
export type LifecycleCommand =
  | {
      type: 'start';
      chatroomId: string;
      role: string;
      lifecycleRevision?: number;
    }
  | {
      type: 'stop';
      chatroomId: string;
      role: string;
      pid?: number;
      lifecycleRevision?: number;
    }
  | {
      type: 'restart';
      chatroomId: string;
      role: string;
      lifecycleRevision?: number;
    }
  | {
      type: 'recover';
      chatroomId: string;
      role: string;
    };
