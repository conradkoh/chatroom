/** User-facing error when daemon is too old to handle an operation (e.g. rename, mkdir). */
export function unsupportedFileWriteOperationMessage(operation: string): string {
  return (
    `Unsupported file write operation "${operation}". ` +
    'Please upgrade chatroom-cli to the latest version and restart the machine daemon ' +
    '(e.g. npm install -g chatroom-cli@latest).'
  );
}
