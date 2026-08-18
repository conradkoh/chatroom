'use client';
import { Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DatePickerField } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useTheme } from '@/modules/theme/ThemeProvider';

type PickerKind = 'native' | 'custom';
type VariantIssue = {
  layoutKey: string;
  wrapKey?: string;
  kindKey?: PickerKind;
  severity: 'do-not-use' | 'known-issue';
  message: string;
};
type WrapOption = { key: string; label: string; wrapInput: boolean };
type Layout = {
  key: string;
  title: string;
  description: string;
  className: string;
  twoFields?: boolean;
};

const NATIVE_DO_NOT_USE_MESSAGE =
  'Do not use — iOS Safari: width not respected, text misaligned, values may change without user interaction.';

const getVariantIssue = (
  layoutKey: string,
  wrapKey: string | undefined,
  kindKey: PickerKind
): VariantIssue | undefined => {
  if (kindKey === 'native') {
    return {
      layoutKey,
      wrapKey,
      kindKey: 'native',
      severity: 'do-not-use',
      message: NATIVE_DO_NOT_USE_MESSAGE,
    };
  }
  return undefined;
};

const layouts: Layout[] = [
  {
    key: 'default',
    title: 'Default width (production pattern)',
    description: 'Bare form fields with no width constraint — matches BuyForm.',
    className: 'space-y-4',
  },
  {
    key: 'full',
    title: 'Full width',
    description: 'Inputs stretch across a visible full-width parent.',
    className: 'w-full space-y-4 rounded-md border bg-muted/20 p-4',
  },
  {
    key: 'constrained',
    title: 'Constrained parent (max-w-md)',
    description: 'Parent capped at max-w-md — key Safari overflow scenario.',
    className: 'w-full space-y-4 rounded-md border bg-muted/20 p-4 sm:max-w-md',
  },
  {
    key: 'flex',
    title: 'Flex side by side',
    description: 'Two date fields in a flex row (forced on mobile for storybook testing).',
    className: 'flex flex-row flex-wrap gap-4 rounded-md border bg-muted/20 p-4',
    twoFields: true,
  },
  {
    key: 'grid',
    title: 'Grid layout (2 columns)',
    description: 'Two fields in a 2-column grid (forced on mobile for storybook testing).',
    className: 'grid grid-cols-2 gap-4 rounded-md border bg-muted/20 p-4',
    twoFields: true,
  },
];
const wraps: WrapOption[] = [
  { key: 'raw', label: 'Native · no flex wrapper', wrapInput: false },
  { key: 'flex', label: 'Native · ios-date-input-flex', wrapInput: true },
];
const kinds: { key: PickerKind; label: string }[] = [
  { key: 'native', label: 'Native temporal input' },
  { key: 'custom', label: 'Custom · Popover + Calendar' },
];

function Field({
  id,
  label,
  type = 'date',
  value,
  onChange,
  wrapInput = false,
  showState = false,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  wrapInput?: boolean;
  showState?: boolean;
}) {
  const input = (
    <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
  );
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {wrapInput ? <div className="ios-date-input-flex">{input}</div> : input}
      {showState && (
        <p className="font-mono text-xs text-muted-foreground">
          state: {value === '' ? '""' : JSON.stringify(value)}
        </p>
      )}
    </div>
  );
}
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
function variantBlockClass(issue?: VariantIssue) {
  return cn(
    'space-y-2 rounded-md',
    issue?.severity === 'do-not-use' && 'border-2 border-destructive/50 bg-destructive/5 p-3'
  );
}
function VariantBlock({
  label,
  issue,
  children,
}: {
  label: string;
  issue?: VariantIssue;
  children: ReactNode;
}) {
  const isDoNotUse = issue?.severity === 'do-not-use';
  return (
    <div className={variantBlockClass(issue)}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {isDoNotUse && <Badge variant="destructive">DO NOT USE</Badge>}
      </div>
      {issue && <p className="text-xs text-destructive">{issue.message}</p>}
      {children}
    </div>
  );
}

export default function DatePickerStorybookPage() {
  const { theme, setTheme } = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});
  const [customDates, setCustomDates] = useState<Record<string, Date | undefined>>({});
  const [recommendedDates, setRecommendedDates] = useState<{
    single?: Date;
    start?: Date;
    end?: Date;
  }>({});
  const setValue = (id: string) => (v: string) => setValues((s) => ({ ...s, [id]: v }));
  const setDate = (id: string) => (v?: Date) => setCustomDates((s) => ({ ...s, [id]: v }));
  const renderFields = (layout: Layout, prefix: string, wrapInput: boolean, showState = false) => {
    const fieldConfigs = layout.twoFields
      ? [
          { id: `${prefix}-start`, label: 'Start date' },
          { id: `${prefix}-end`, label: 'End date' },
        ]
      : [{ id: `${prefix}-date`, label: 'Date' }];

    return (
      <>
        {fieldConfigs.map(({ id, label }) => (
          <Field
            key={id}
            id={id}
            label={label}
            value={values[id] ?? ''}
            onChange={setValue(id)}
            wrapInput={wrapInput}
            showState={showState}
          />
        ))}
      </>
    );
  };
  const renderCustom = (layout: Layout) => {
    const fieldConfigs = layout.twoFields
      ? [
          { id: `${layout.key}-custom-start`, label: 'Start date' },
          { id: `${layout.key}-custom-end`, label: 'End date' },
        ]
      : [{ id: `${layout.key}-custom-date`, label: 'Date' }];

    return (
      <>
        {fieldConfigs.map(({ id, label }) => (
          <DatePickerField
            key={id}
            id={id}
            label={label}
            date={customDates[id]}
            onSelect={setDate(id)}
          />
        ))}
      </>
    );
  };
  return (
    <div className="container mx-auto max-w-4xl space-y-8 px-4 py-8">
      <header>
        <Link
          href="/developer/components"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Component Storybook
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Safari Date Picker Story</h1>
        <p className="mt-2 text-muted-foreground">
          Component Storybook story at <code>/developer/components/date-picker</code>. Compare
          native temporal inputs (DO NOT USE) and custom Popover + Calendar pickers on Safari and
          iOS, including dark mode and constrained layouts.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-4">
        <span className="mr-2 font-medium">Theme:</span>
        <Button
          variant={theme === 'light' ? 'default' : 'outline'}
          onClick={() => setTheme('light')}
        >
          <Sun className="mr-2 size-4" />
          Light
        </Button>
        <Button variant={theme === 'dark' ? 'default' : 'outline'} onClick={() => setTheme('dark')}>
          <Moon className="mr-2 size-4" />
          Dark
        </Button>
        <Button
          variant={theme === 'system' ? 'default' : 'outline'}
          onClick={() => setTheme('system')}
        >
          System
        </Button>
      </div>
      <Section
        title="Recommended implementations"
        description="Production-ready custom date pickers. Import from @/components/ui/date-picker — avoids native temporal inputs."
      >
        <div className="space-y-8">
          <div>
            <p className="mb-3 text-sm font-medium text-muted-foreground">
              Custom Popover + Calendar
            </p>
            <div className="max-w-sm">
              <DatePickerField
                id="recommended-single"
                label="Date"
                date={recommendedDates.single}
                onSelect={(d) => setRecommendedDates((s) => ({ ...s, single: d }))}
              />
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm font-medium text-muted-foreground">
              Custom Popover + Calendar (side by side)
            </p>
            <div className="flex flex-row flex-wrap gap-4">
              <DatePickerField
                id="recommended-start"
                label="Start date"
                date={recommendedDates.start}
                onSelect={(d) => setRecommendedDates((s) => ({ ...s, start: d }))}
              />
              <DatePickerField
                id="recommended-end"
                label="End date"
                date={recommendedDates.end}
                onSelect={(d) => setRecommendedDates((s) => ({ ...s, end: d }))}
              />
            </div>
          </div>
        </div>
      </Section>
      <div className="space-y-4 rounded-lg border-2 border-destructive/50 bg-destructive/5 p-6">
        <h2 className="text-xl font-semibold text-destructive">
          Native temporal inputs: DO NOT USE
        </h2>
        <p className="text-sm text-muted-foreground">
          Do not use native HTML temporal inputs (<code>date</code>, <code>datetime-local</code>,{' '}
          <code>time</code>, <code>month</code>, <code>week</code>) in production. They remain in
          this story for regression comparison only.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            <strong>Width:</strong> iOS Safari (especially dark mode) does not respect parent width
            constraints.
          </li>
          <li>
            <strong>Text alignment:</strong> Selected values are not properly centered vertically or
            horizontally.
          </li>
          <li>
            <strong>Auto-modification:</strong> Values may change without user interaction — compare
            visual display with the <code className="font-mono text-xs">state:</code> readout.
          </li>
        </ul>
        <p className="text-sm text-muted-foreground">
          Use custom Popover + Calendar pickers instead.
        </p>
      </div>
      <div className="space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <h2 className="text-xl font-semibold text-destructive">Known Issues (iOS Safari)</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            <strong>Native temporal inputs:</strong> Confirmed DO NOT USE — width, alignment, and
            auto-selection issues (see policy above). The <code>ios-date-input-flex</code> wrapper
            only partially addresses width.
          </li>
          <li>
            <strong>Side-by-side layouts:</strong> Forced side-by-side in flex/grid sections for
            mobile testing.
          </li>
          <li>
            <strong>Custom date picker popover:</strong> Opening the popover may cause parent
            content height to shift — check custom sections below.
          </li>
        </ul>
      </div>
      {layouts.map((layout) => (
        <Section key={layout.key} title={layout.title} description={layout.description}>
          <div className="space-y-6">
            {kinds.map((kind) =>
              kind.key === 'native' ? (
                wraps.map((wrap) => (
                  <VariantBlock
                    key={`${layout.key}-${wrap.key}`}
                    label={wrap.label}
                    issue={getVariantIssue(layout.key, wrap.key, 'native')}
                  >
                    <div className={layout.className}>
                      {renderFields(layout, `${layout.key}-${wrap.key}`, wrap.wrapInput)}
                    </div>
                  </VariantBlock>
                ))
              ) : (
                <VariantBlock key={`${layout.key}-custom`} label={kind.label}>
                  <div className={layout.className}>{renderCustom(layout)}</div>
                </VariantBlock>
              )
            )}
          </div>
        </Section>
      ))}
      <Section
        title="All native temporal types"
        description="Native-only: date, datetime-local, time, month, week — retained for regression comparison only."
      >
        {wraps.map((wrap) => (
          <VariantBlock
            key={wrap.key}
            label={wrap.label}
            issue={getVariantIssue('temporal', wrap.key, 'native')}
          >
            <div className="space-y-4">
              {(['date', 'datetime-local', 'time', 'month', 'week'] as const).map((type) => (
                <Field
                  key={type}
                  id={`temporal-${wrap.key}-${type}`}
                  label={type}
                  type={type}
                  value={values[`temporal-${wrap.key}-${type}`] ?? ''}
                  onChange={setValue(`temporal-${wrap.key}-${type}`)}
                  wrapInput={wrap.wrapInput}
                  showState
                />
              ))}
            </div>
          </VariantBlock>
        ))}
      </Section>
    </div>
  );
}
