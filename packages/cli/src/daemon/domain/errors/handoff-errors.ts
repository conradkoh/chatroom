export type HandoffErrorCode =
  | 'AUTH_FAILED'
  | 'INVALID_ROLE'
  | 'INVALID_TARGET_ROLE'
  | 'ENHANCER_REVIEW_IN_PROGRESS'
  | 'ACTIVE_JOB_EXISTS'
  | 'NO_PLANNER_USER_TASK'
  | 'ENHANCER_CONFIG_INCOMPLETE'
  | 'ENHANCER_NOT_ENABLED';

export type HandoffRejectedError = {
  code: HandoffErrorCode;
  message: string;
  suggestedTargets?: string[];
};

export type ExecuteHandoffResult = {
  success: boolean;
  error?: HandoffRejectedError;
  messageId: string | null;
  completedTaskIds: string[];
  newTaskId: string | null;
  promotedTaskId: string | null;
  supportsNativeIntegration?: boolean;
};
