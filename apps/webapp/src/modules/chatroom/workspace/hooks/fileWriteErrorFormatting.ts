export type FileWriteOperation = 'create' | 'update' | 'delete' | 'rename' | 'mkdir';

const LEGACY_MISSING_DATA_ERROR = 'Missing file data';

/** Map daemon errors to actionable messages for unsupported ops on old clients. */
// fallow-ignore-next-line complexity
export function formatFileWriteError(errorMessage: string, operation?: FileWriteOperation): string {
  if (
    errorMessage === LEGACY_MISSING_DATA_ERROR &&
    operation &&
    operation !== 'create' &&
    operation !== 'update'
  ) {
    return (
      `Your machine daemon does not support the "${operation}" operation. ` +
      'Please upgrade chatroom-cli to the latest version and restart the machine daemon ' +
      '(e.g. npm install -g chatroom-cli@latest).'
    );
  }
  if (errorMessage.startsWith('Unsupported file write operation')) {
    return errorMessage;
  }
  return errorMessage;
}
