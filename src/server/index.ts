import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { apiRoutes } from './routes/api';
import { sseRoutes } from './routes/sse';
import { loadConfig } from './config';

const app = new Hono();
const config = loadConfig();

// Middleware
app.use('/*', cors());

// API routes
app.route('/api', apiRoutes);

// SSE endpoint
app.route('/events', sseRoutes);

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// Static files (client)
app.use('/*', serveStatic({ root: './public' }));

// Fallback to index.html for SPA
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="refresh" content="0; url=/index.html">
</head>
<body></body>
</html>`);
});

const port = config.port || 3847;
const host = config.host || '127.0.0.1';

serve(
  {
    fetch: app.fetch,
    port,
    hostname: host,
  },
  (info) => {
    console.log(`
╭─────────────────────────────────────────╮
│                                         │
│   📰 Claude RSS Reader                  │
│                                         │
│   Running at http://${host}:${info.port}     │
│                                         │
│   Open in browser to view your feeds    │
│   Claude will notify you when ready!    │
│                                         │
╰─────────────────────────────────────────╯
`);
  }
);
