export interface HandleChangeCommandVisibilityInput {
  receiptHandle: string;
  visibilityTimeoutMs: number;
}

export interface HandleChangeCommandVisibilityDependencies {
  changeMessageVisibility(receiptHandle: string, visibilityTimeoutMs: number): Promise<void>;
}

export function handleChangeCommandVisibility(
  deps: HandleChangeCommandVisibilityDependencies,
  input: HandleChangeCommandVisibilityInput
): Promise<void> {
  return deps.changeMessageVisibility(input.receiptHandle, input.visibilityTimeoutMs);
}
