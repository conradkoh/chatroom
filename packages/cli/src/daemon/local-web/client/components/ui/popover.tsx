import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from '@/lib/utils';
import { portaledMenuFloatingClassName } from '@/lib/menu-styles';
export function Popover({ modal = false, ...props }: PopoverPrimitive.Root.Props) { return <PopoverPrimitive.Root data-slot="popover" modal={modal} {...props} />; }
export function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) { return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />; }
export function PopoverContent({ className, align='start', side='bottom', sideOffset=4, ...props }: PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props,'align'|'side'|'sideOffset'>) { return <PopoverPrimitive.Portal><PopoverPrimitive.Positioner align={align} side={side} sideOffset={sideOffset} className="isolate z-50"><PopoverPrimitive.Popup className={cn('w-72 origin-(--transform-origin) overflow-hidden p-0 data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95',portaledMenuFloatingClassName,className)} {...props}/></PopoverPrimitive.Positioner></PopoverPrimitive.Portal>; }
