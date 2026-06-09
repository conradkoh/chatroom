export interface ResumeStormCheck {
  isStorm: boolean;
  endCount: number;
  windowMs: number;
  threshold: number;
}

export interface ResumeStormTracker {
  record(chatroomId: string, role: string, now: number): ResumeStormCheck;
  reset(chatroomId: string, role: string): void;
}
