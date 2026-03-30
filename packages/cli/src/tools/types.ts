/**
 * Tool Types — Base types shared by all CLI tools.
 */

/** Result of a tool execution. */
export interface ToolResult {
  success: boolean;
  /** Path to the output file (if any). */
  outputPath?: string;
  /** Human-readable message for the agent. */
  message: string;
}
