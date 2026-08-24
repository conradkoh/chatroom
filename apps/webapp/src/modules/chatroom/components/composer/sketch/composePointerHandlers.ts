import type { ComponentProps } from 'react';

export function composePointerHandlers(
  ...handlers: (ComponentProps<'canvas'>['onPointerMove'] | undefined)[]
): ComponentProps<'canvas'>['onPointerMove'] {
  return (event) => handlers.forEach((handler) => handler?.(event));
}
