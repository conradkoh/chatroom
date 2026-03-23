import migrations from '@convex-dev/migrations/convex.config.js';
import { defineApp } from 'convex/server';

// Explicit type annotation required — tsc --build (emitDeclarationOnly) cannot
// infer the return type of defineApp() without referencing internal Convex types.
// See: TS2742 "The inferred type of 'app' cannot be named..."
const app: ReturnType<typeof defineApp> = defineApp();
app.use(migrations);

export default app;
