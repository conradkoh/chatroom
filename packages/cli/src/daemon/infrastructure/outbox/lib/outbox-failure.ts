// fallow-ignore-file complexity
export type OutboxErrorLogger = Pick<Console, 'error'>;

/**
 * Report a failed projection without allowing an optional adapter callback to
 * prevent the lower-level outbox from applying its failure policy.
 */
export function reportOutboxFailure(args: {
  operation: string;
  deliveryKey: string;
  error: unknown;
  disposition: 'retrying' | 'quarantined';
  onError?: ((error: unknown) => void) | undefined;
  logger?: OutboxErrorLogger | undefined;
}): void {
  const logger = args.logger ?? console;
  try {
    args.onError?.(args.error);
  } catch (callbackError) {
    try {
      logger.error(
        `[outbox] Failure callback threw for ${args.operation} key=${args.deliveryKey}`,
        callbackError
      );
    } catch {
      /* Logging must not interrupt queue bookkeeping. */
    }
  }
  try {
    logger.error(
      `[outbox] ${args.disposition}: ${args.operation} for key=${args.deliveryKey}`,
      args.error
    );
  } catch {
    /* Logging must not interrupt queue bookkeeping. */
  }
}

/** Only explicit argument-schema rejection is permanent; unknown errors retry. */
export function isOutboxArgumentValidationError(error: unknown): boolean {
  return error instanceof Error && /\bArgumentValidationError:/.test(error.message);
}
