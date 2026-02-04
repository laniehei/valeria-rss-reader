import { Hono } from 'hono';
import { notificationService } from '../services/notification';
import { feedService } from '../services/feed';

const api = new Hono();

// Claude hook endpoint - receives notifications from Claude Code
api.post('/claude-ready', async (c) => {
  let event = 'ready';

  try {
    const body = await c.req.json();
    event = body.event || 'ready';
  } catch {
    // Body might be empty, that's fine
  }

  // Broadcast to all connected clients
  await notificationService.broadcast({
    type: 'claude_ready',
    event,
    timestamp: Date.now(),
  });

  console.log(`Claude notification: ${event} (${notificationService.getClientCount()} clients)`);

  return c.json({ success: true });
});

// Get feed items
api.get('/feed', async (c) => {
  const provider = c.req.query('provider');
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');

  try {
    const items = await feedService.getItems({ provider, limit, offset });
    return c.json({ items, hasMore: items.length === limit });
  } catch (err) {
    console.error('Failed to fetch feed:', err);
    return c.json({ items: [], hasMore: false, error: 'Failed to fetch feed' });
  }
});

// Get feed item by ID
api.get('/feed/:id', async (c) => {
  const id = c.req.param('id');
  const item = await feedService.getItem(id);

  if (!item) {
    return c.json({ error: 'Not found' }, 404);
  }

  return c.json(item);
});

// Mark item as read
api.post('/feed/:id/read', async (c) => {
  const id = c.req.param('id');
  await feedService.markAsRead(id);
  return c.json({ success: true });
});

// Refresh feeds
api.post('/feed/refresh', async (c) => {
  await feedService.refresh();
  return c.json({ success: true });
});

// Get available providers
api.get('/providers', (c) => {
  const providers = feedService.getProviders();
  return c.json({ providers });
});

export { api as apiRoutes };
