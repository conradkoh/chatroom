'use client';

import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const TIMEZONES = ['America/New_York', 'Europe/London', 'Asia/Singapore', 'UTC'] as const;

export default function LuxonTestPage() {
  const [isoInput, setIsoInput] = useState(() => DateTime.now().toISO() ?? '');

  const parsed = useMemo(() => {
    const dt = DateTime.fromISO(isoInput);
    if (!dt.isValid) return null;
    return dt;
  }, [isoInput]);

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-foreground">Luxon DateTime</h1>
          <p className="text-muted-foreground">
            Demonstrates luxon for parsing, formatting, and timezone conversion — the preferred
            datetime library for this project.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>ISO Input</CardTitle>
            <CardDescription>
              Edit an ISO string and see luxon transformations below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={isoInput}
              onChange={(e) => setIsoInput(e.target.value)}
              aria-label="ISO datetime input"
            />
          </CardContent>
        </Card>

        {parsed ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Formatting</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm font-mono">
                <p>toLocaleString: {parsed.toLocaleString(DateTime.DATETIME_FULL)}</p>
                <p>toRelative: {parsed.toRelative()}</p>
                <p>weekday: {parsed.weekdayLong}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Timezone Conversions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm font-mono">
                {TIMEZONES.map((tz) => (
                  <p key={tz}>
                    {tz}: {parsed.setZone(tz).toFormat('yyyy-LL-dd HH:mm ZZZZ')}
                  </p>
                ))}
              </CardContent>
            </Card>
          </div>
        ) : (
          <p className="text-destructive text-sm">
            Invalid ISO datetime — luxon could not parse input.
          </p>
        )}
      </div>
    </div>
  );
}
