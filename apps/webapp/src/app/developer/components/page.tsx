'use client';

import Link from 'next/link';

import { componentStorybookEntries } from './registry';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function DeveloperComponentsIndexPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <Link
            href="/developer"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            ← Developer
          </Link>
          <h1 className="mb-4 mt-2 text-4xl font-bold text-foreground">Component Storybook</h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Organized visual and compatibility stories for UI components. Each story isolates a
            component or pattern for Safari/iOS regression checking.
          </p>
          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">
              <strong>Note:</strong> These pages are only available in development mode. For broader
              feature demos, see the{' '}
              <Link href="/test" className="text-primary underline-offset-4 hover:underline">
                /test
              </Link>{' '}
              route.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {componentStorybookEntries.map((entry) => {
            const Icon = entry.icon;
            return (
              <Link key={entry.path} href={entry.path} className="group">
                <Card className="h-full border-border bg-card transition-all duration-200 hover:scale-[1.02] hover:shadow-lg">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="rounded-lg bg-primary/10 p-2 group-hover:bg-primary/20">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <CardTitle className="text-lg font-semibold group-hover:text-primary">
                          {entry.title}
                        </CardTitle>
                      </div>
                      {entry.status && (
                        <Badge
                          variant="secondary"
                          className="text-xs text-orange-600 dark:text-orange-400"
                        >
                          {entry.status}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <CardDescription className="mb-4 line-clamp-3">
                      {entry.description}
                    </CardDescription>
                    <div className="mb-4 space-y-3">
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">
                          Best practices
                        </p>
                        <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                          {entry.bestPractices.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-destructive">
                          Practices to avoid
                        </p>
                        <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                          {entry.practicesToAvoid.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {entry.badges?.map((badge) => (
                        <Badge
                          key={badge}
                          variant="outline"
                          className="border-border bg-accent/50 text-xs"
                        >
                          {badge}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
