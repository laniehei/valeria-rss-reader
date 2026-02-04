import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { notificationService } from '../services/notification';

const sse = new Hono();

sse.get('/', async (c) => {
  return streamSSE(c, async (stream) => {
    const clientId = crypto.randomUUID();

    // Register this client for notifications
    const unsubscribe = notificationService.subscribe(clientId, async (event) => {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });
    });

    // Send initial connection event
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ clientId, timestamp: Date.now() }),
    });

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: 'heartbeat',
          data: JSON.stringify({ timestamp: Date.now() }),
        });
      } catch {
        clearInterval(heartbeat);
      }
    }, 30000);

    // Cleanup on disconnect
    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    // Keep stream open indefinitely
    await new Promise(() => {});
  });
});

export { sse as sseRoutes };
