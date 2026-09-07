export interface HandleDeleteCommandDependencies {
  deleteMessage(receiptHandle: string): Promise<void>;
}

export function handleDeleteCommand(
  deps: HandleDeleteCommandDependencies,
  receiptHandle: string
): Promise<void> {
  return deps.deleteMessage(receiptHandle);
}
