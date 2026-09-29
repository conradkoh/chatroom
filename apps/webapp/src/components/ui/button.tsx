import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-none border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-chatroom-border-strong focus-visible:ring-0 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-chatroom-status-error [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-accent/90',
        outline:
          'border-chatroom-border bg-chatroom-bg-secondary text-chatroom-text-primary shadow-xs hover:bg-chatroom-bg-hover aria-expanded:bg-chatroom-bg-hover',
        secondary:
          'border-chatroom-border bg-chatroom-bg-tertiary text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary aria-expanded:bg-chatroom-bg-hover',
        ghost:
          'hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary aria-expanded:bg-chatroom-bg-hover',
        destructive:
          'border-chatroom-status-error bg-chatroom-status-error/10 text-chatroom-status-error hover:bg-chatroom-status-error/20',
        link: 'text-chatroom-accent underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-9 gap-1.5 px-2.5 in-data-[slot=button-group]:rounded-none has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 rounded-none px-2 text-xs in-data-[slot=button-group]:rounded-none has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1 rounded-none px-2.5 in-data-[slot=button-group]:rounded-none has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5',
        lg: 'h-10 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        icon: 'size-9',
        'icon-xs':
          "size-6 rounded-none in-data-[slot=button-group]:rounded-none [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 rounded-none in-data-[slot=button-group]:rounded-none',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
