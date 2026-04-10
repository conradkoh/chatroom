import aggregate from '@convex-dev/aggregate/convex.config.js';
import migrations from '@convex-dev/migrations/convex.config.js';
import { defineApp } from 'convex/server';

const app = defineApp();
app.use(aggregate);
app.use(migrations);

export default app;
