'use client';

import { CalendarIcon, MoreHorizontal, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const testSteps: {
  number: number;
  title: string;
  description: ReactNode;
  critical?: boolean;
}[] = [
  {
    number: 1,
    title: 'Open Action Menu',
    description: 'Click the "Actions" button to open the dropdown menu.',
  },
  {
    number: 2,
    title: 'Test Click Outside',
    description:
      'Click outside the menu to close it, then verify the "Actions" button is still clickable.',
  },
  {
    number: 3,
    title: 'Test Dialog Flow',
    description:
      'Open action menu → click "Add" → click outside dialog to close → ensure "Actions" button remains clickable.',
  },
  {
    number: 4,
    title: 'Test iOS Calendar (Critical)',
    critical: true,
    description: (
      <>
        Open action menu → click "Add" → click date picker button →{' '}
        <strong>verify calendar opens on iOS devices</strong>.
      </>
    ),
  },
  {
    number: 5,
    title: 'Final Verification',
    description:
      'After completing all interactions, click outside to close everything and ensure the "Actions" button is still clickable.',
  },
];

export default function ShadcnModalTestPage() {
  const [date, setDate] = useState<Date>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [title, setTitle] = useState('');

  const handleAddAction = () => {
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    console.log('Saving:', { title, date });
    setIsDialogOpen(false);
    setTitle('');
    setDate(undefined);
  };

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Shadcn Modal Components Test</h1>
          <p className="text-muted-foreground mt-2">
            Testing complex interactions between DropdownMenu, Dialog, and Popover components
          </p>
        </div>

        {/* Known Issues */}
        <div className="border rounded-lg p-6 space-y-4 bg-amber-50 dark:bg-amber-950/20">
          <h2 className="text-xl font-semibold text-amber-900 dark:text-amber-100">
            ⚠️ Known Issues (Post Base-UI Migration)
          </h2>
          <div className="space-y-4 text-sm">
            <div>
              <h3 className="font-medium text-amber-800 dark:text-amber-200 mb-2">
                1. Body pointer-events stuck (Mitigated)
              </h3>
              <p className="text-amber-800 dark:text-amber-300">
                After closing a modal,{' '}
                <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">
                  pointer-events: none
                </code>{' '}
                may remain on <code>body</code>, leaving the page unresponsive. This is now{' '}
                <strong>mitigated</strong> by <code>releaseBodyPointerLock</code>, wired on the
                close handlers of both the global <code>components/ui/dialog</code> root and the
                chatroom <code>Dialog</code> root, which clears <code>pointer-events</code>,{' '}
                <code>overflow</code>, and <code>data-scroll-locked</code> when a dialog closes.
                Edge cases (e.g. dialogs unmounted without firing a close transition, or menus
                opened outside a Dialog root) may still leave the lock; report any that reproduce.
              </p>
            </div>

            <div>
              <h3 className="font-medium text-amber-800 dark:text-amber-200 mb-2">
                2. Nested Popover/Calendar (iOS)
              </h3>
              <p className="text-amber-800 dark:text-amber-300">
                Date pickers (Popover + Calendar) rendered inside a Dialog are the most complex
                nesting on this page. With Base UI, popovers mount through the dialog's portal host
                and stay at the modal z-index band; on iOS this path remains the least exercised —
                verify the calendar opens and is interactive on-device. If it regresses, note the
                repro steps here.
              </p>
            </div>
          </div>
        </div>

        {/* Fixes Applied */}
        <div className="border rounded-lg p-6 space-y-4 bg-green-50 dark:bg-green-950/20">
          <h2 className="text-xl font-semibold text-green-900 dark:text-green-100">
            ✅ Fixes Applied
          </h2>
          <div className="space-y-4 text-sm">
            <div>
              <h3 className="font-medium text-green-800 dark:text-green-200 mb-2">
                1. Default Modal Prop Override
              </h3>
              <p className="text-green-700 dark:text-green-300 mb-2">
                Modified all shadcn UI modal components to default{' '}
                <code className="bg-green-100 dark:bg-green-900 px-1 rounded">modal=true</code>:
              </p>
              <ul className="list-disc list-inside ml-4 space-y-1 text-green-700 dark:text-green-300">
                <li>
                  <code>src/components/ui/dropdown-menu.tsx</code>
                </li>
                <li>
                  <code>src/components/ui/dialog.tsx</code>
                </li>
                <li>
                  <code>src/components/ui/popover.tsx</code>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-green-800 dark:text-green-200 mb-2">
                2. Base UI migration
              </h3>
              <p className="text-green-700 dark:text-green-300 mb-2">
                Modal primitives now use <code>@base-ui/react</code> instead of Radix UI. All{' '}
                <code>@radix-ui/*</code> dependencies (including the former{' '}
                <code>@radix-ui/react-dismissable-layer</code> pnpm override) have been removed.
              </p>
            </div>

            <div>
              <h3 className="font-medium text-green-800 dark:text-green-200 mb-2">
                3. How These Fixes Work
              </h3>
              <ul className="list-disc list-inside ml-4 space-y-1 text-green-700 dark:text-green-300">
                <li>Proper modal behavior ensures correct focus and dismissal management</li>
                <li>
                  Base UI uses Floating UI for positioning and consistent dismissable-layer behavior
                </li>
                <li>iOS calendar issues are resolved through proper modal portal management</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Test Components */}
        <div className="border rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-semibold">Test Components</h2>
          <p className="text-sm text-muted-foreground">
            Use the action button below to test the interaction flow: DropdownMenu → Dialog → Date
            Picker (Popover + Calendar)
          </p>

          <div className="flex justify-center pt-4">
            <DropdownMenu>
              <DropdownMenuTrigger className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <MoreHorizontal className="h-4 w-4 mr-2" />
                Actions
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={handleAddAction}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Component Status */}
          <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-950/50 rounded">
            <h3 className="font-medium mb-2">Current State</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Dialog:</span>{' '}
                {isDialogOpen ? 'Open' : 'Closed'}
              </div>
              <div>
                <span className="text-muted-foreground">Selected Date:</span>{' '}
                {date ? date.toDateString() : 'None'}
              </div>
            </div>
          </div>
        </div>

        {/* Dialog Component */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Item</DialogTitle>
              <DialogDescription>
                Test form with date picker. The calendar should open correctly on all devices,
                including iOS.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="title" className="text-right">
                  Title
                </Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="col-span-3"
                  placeholder="Enter title..."
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Date</Label>
                <div className="col-span-3">
                  <Popover>
                    <PopoverTrigger
                      className={cn(
                        buttonVariants({ variant: 'outline' }),
                        'w-full justify-start text-left font-normal'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {date ? date.toDateString() : <span>Pick a date</span>}
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={date} onSelect={setDate} />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSave}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Test Instructions */}
        <div className="border rounded-lg p-6 space-y-4 bg-blue-50 dark:bg-blue-950/20">
          <h2 className="text-xl font-semibold text-blue-900 dark:text-blue-100">
            📋 Test Instructions
          </h2>
          <div className="space-y-4 text-sm">
            <p className="text-blue-800 dark:text-blue-200 font-medium">
              Follow these steps in order to verify all fixes are working correctly:
            </p>

            <div className="space-y-3">
              {testSteps.map((step) => (
                <div key={step.number} className="flex gap-3">
                  <span
                    className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                      step.critical ? 'bg-orange-600' : 'bg-blue-600'
                    }`}
                  >
                    {step.number}
                  </span>
                  <div>
                    <p
                      className={`font-medium ${
                        step.critical
                          ? 'text-orange-900 dark:text-orange-100'
                          : 'text-blue-900 dark:text-blue-100'
                      }`}
                    >
                      {step.title}
                    </p>
                    <p
                      className={
                        step.critical
                          ? 'text-orange-800 dark:text-orange-200'
                          : 'text-blue-800 dark:text-blue-200'
                      }
                    >
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 bg-green-100 dark:bg-green-900/30 rounded">
              <h3 className="font-medium text-green-900 dark:text-green-100 mb-2">
                ✅ Expected Results
              </h3>
              <ul className="list-disc list-inside space-y-1 text-green-800 dark:text-green-200 text-xs">
                <li>All buttons and interactive elements remain clickable throughout the test</li>
                <li>
                  Body pointer-events is cleared on dialog close via{' '}
                  <code>releaseBodyPointerLock</code> (report any remaining lock edge cases)
                </li>
                <li>Date picker opens correctly inside dialogs on all devices, including iOS</li>
                <li>Smooth transitions between all modal states</li>
                <li>Page remains fully responsive after all interactions</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
