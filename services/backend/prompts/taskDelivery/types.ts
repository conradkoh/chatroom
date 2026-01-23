/**
 * Types for the task delivery prompt system.
 * These types define the context and section interfaces for building
 * prompts shown when an agent receives a task.
 */

/**
 * Context message from the context window
 */
export interface ContextMessage {
  _id: string;
  senderRole: string;
  content: string;
  type: string;
  targetRole?: string;
  classification?: string;
  attachedTaskIds?: string[];
}

/**
 * Attached task information
 */
export interface AttachedTask {
  id: string;
  content: string;
  status: string;
  createdBy: string;
  backlogStatus?: string;
}

/**
 * Task information
 */
export interface TaskInfo {
  _id: string;
  content: string;
  status: string;
  createdBy: string;
  queuePosition: number;
}

/**
 * Message information
 */
export interface MessageInfo {
  _id: string;
  content: string;
  senderRole: string;
  type: string;
  targetRole?: string;
}

/**
 * Participant information
 */
export interface ParticipantInfo {
  role: string;
  status: string;
}

/**
 * Context window information
 */
export interface ContextWindowInfo {
  originMessage: (ContextMessage & { attachedTasks?: AttachedTask[] }) | null;
  contextMessages: (ContextMessage & { attachedTasks?: AttachedTask[] })[];
  classification: string | null;
}

/**
 * Role prompt information
 */
export interface RolePromptInfo {
  prompt: string;
  currentClassification: 'question' | 'new_feature' | 'follow_up' | null;
  availableHandoffRoles: string[];
  restrictionReason: string | null;
}

/**
 * The complete context needed to render a task delivery prompt.
 * This is passed to all section render functions.
 */
export interface TaskDeliveryContext {
  chatroomId: string;
  role: string;
  task: TaskInfo;
  message: MessageInfo | null;
  participants: ParticipantInfo[];
  contextWindow: ContextWindowInfo;
  rolePrompt: RolePromptInfo;
  teamName: string;
  teamRoles: string[];
  /**
   * Current timestamp in ISO format for agent awareness of current time.
   * Helps agents understand temporal context (e.g., "it's now 3pm").
   */
  currentTimestamp: string;
}

/**
 * A prompt section that can be conditionally rendered.
 * Sections are composable building blocks of the task delivery prompt.
 */
export interface PromptSection {
  /**
   * Unique identifier for this section
   */
  id: string;

  /**
   * Display title for the section header
   */
  title: string;

  /**
   * Emoji icon for the section header
   */
  icon: string;

  /**
   * Determines if this section should be rendered for the given context.
   * Return false to skip rendering this section entirely.
   */
  shouldRender(ctx: TaskDeliveryContext): boolean;

  /**
   * Renders the section content.
   * Returns the text content without the header (header is added by the formatter).
   */
  render(ctx: TaskDeliveryContext): string;
}

/**
 * JSON output structure for the task delivery prompt.
 * This is the programmatic data agents can parse.
 */
export interface TaskDeliveryJsonOutput {
  /**
   * Current timestamp in ISO format when the task was delivered.
   * Helps agents understand the temporal context of the task.
   */
  currentTimestamp: string;
  message: {
    id: string;
    senderRole: string;
    content: string;
    type: string;
  };
  task: {
    id: string;
    status: string;
    createdBy: string;
    queuePosition: number;
  };
  chatroom: {
    id: string;
    participants: {
      role: string;
      status: string;
      isYou: boolean;
      availableForHandoff: boolean;
    }[];
  };
  context: {
    originMessage: {
      id: string;
      senderRole: string;
      content: string;
      classification?: string;
      attachedTaskIds?: string[];
      attachedTasks?: AttachedTask[];
    } | null;
    allMessages: {
      id: string;
      senderRole: string;
      content: string;
      type: string;
      targetRole?: string;
      classification?: string;
      attachedTaskIds?: string[];
      attachedTasks?: AttachedTask[];
    }[];
    currentClassification: string | null;
  };
  instructions: {
    taskStartedCommand: string | null;
    taskCompleteCommand: string;
    availableHandoffRoles: string[];
    terminationRole: string;
    classification: string | null;
    handoffRestriction: string | null;
    classificationCommands: {
      question: string;
      new_feature: string;
      follow_up: string;
    };
    contextCommands?: string[];
  };
}

/**
 * The complete response from getTaskDeliveryPrompt.
 */
export interface TaskDeliveryPromptResponse {
  /**
   * Human-readable prompt sections, pre-formatted for display
   */
  humanReadable: string;

  /**
   * Structured JSON data for programmatic parsing
   */
  json: TaskDeliveryJsonOutput;
}
