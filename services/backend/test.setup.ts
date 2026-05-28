/// <reference types="vite/client" />
import migrationsTest from '@convex-dev/migrations/test';
import { convexTest } from 'convex-test';

import schema from './convex/schema';

export const modules = import.meta.glob('./**/!(*.*.*)*.*s');
export const t = convexTest(schema, modules);
migrationsTest.register(t);
