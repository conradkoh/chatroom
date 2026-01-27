/**
 * Error formatting utilities for consistent CLI error messages
 */

/**
 * Format an error message with optional suggestions
 */
export function formatError(message: string, suggestions?: string[]): void {
  console.error(`❌ ${message}`);
  if (suggestions && suggestions.length > 0) {
    console.error('');
    suggestions.forEach((suggestion) => {
      console.error(`💡 ${suggestion}`);
    });
  }
}

/**
 * Format a validation error with got/expected pattern
 */
export function formatValidationError(field: string, value: string, expected: string): void {
  formatError(`Invalid ${field}`, [`Got: ${value}`, `Expected: ${expected}`]);
}

/**
 * Format a file access error
 */
export function formatFileError(operation: string, filePath: string, reason?: string): void {
  const message = `Cannot ${operation} file: ${filePath}`;
  if (reason) {
    formatError(message, [`Reason: ${reason}`]);
  } else {
    console.error(`❌ ${message}`);
  }
}

/**
 * Format an authentication error
 */
export function formatAuthError(currentUrl?: string, otherUrls?: string[]): void {
  console.error(`❌ Not authenticated${currentUrl ? ` for: ${currentUrl}` : ''}`);

  if (otherUrls && otherUrls.length > 0) {
    console.error(`\n💡 You have sessions for other environments:`);
    for (const url of otherUrls) {
      console.error(`   • ${url}`);
    }
    console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
    console.error(`   CHATROOM_CONVEX_URL=${otherUrls[0]} chatroom <command>`);
    console.error(`\n   Or to authenticate for the current environment:`);
  }

  console.error(`   chatroom auth login`);
}

/**
 * Format a chatroom ID validation error
 */
export function formatChatroomIdError(chatroomId: string | undefined): void {
  formatValidationError(
    'chatroom ID format',
    `ID must be 20-40 characters (got ${chatroomId?.length || 0})`,
    '20-40 character string'
  );
}
