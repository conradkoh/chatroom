/** Extract the human-readable message from a Convex error (or any thrown value). */
export function integrationErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const data = (err as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}
