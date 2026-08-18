'use client';

import { Boxes } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const developerSections = [
  {
    path: '/developer/components',
    title: 'Component Storybook',
    description:
      'Browse UI component compatibility stories. Each entry shows recommended patterns and practices to avoid — especially for Safari/iOS regressions.',
    icon: Boxes,
    badges: ['Safari', 'Best Practices', 'Anti-patterns'],
    status: 'stable' as const,
  },
];

export default function DeveloperIndexPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="mb-4 text-4xl font-bold text-foreground">Developer</h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Internal developer resources for component compatibility, patterns, and regression
            stories. Available in development mode only.
          </p>
          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">
              <strong>Note:</strong> For broader feature demos and interactive tests, see the{' '}
              <Link href="/test" className="text-primary underline-offset-4 hover:underline">
                /test
              </Link>{' '}
              route.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {developerSections.map((section) => {
            const Icon = section.icon;
            return (
              <Link key={section.path} href={section.path} className="group">
                <Card className="h-full border-border bg-card transition-all duration-200 hover:scale-[1.02] hover:shadow-lg">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="rounded-lg bg-primary/10 p-2 group-hover:bg-primary/20">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <CardTitle className="text-lg font-semibold group-hover:text-primary">
                          {section.title}
                        </CardTitle>
                      </div>
                      <Badge
                        variant="default"
                        className="text-xs text-green-600 dark:text-green-400"
                      >
                        {section.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <CardDescription className="mb-4 line-clamp-3">
                      {section.description}
                    </CardDescription>
                    <div className="flex flex-wrap gap-2">
                      {section.badges.map((badge) => (
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
