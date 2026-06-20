import * as Sentry from '@sentry/nextjs';

import { initSentryClient } from './src/lib/sentry/clientInit';

initSentryClient();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
