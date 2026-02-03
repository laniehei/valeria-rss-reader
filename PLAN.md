# Claude RSS Reader - Implementation Plan

A standalone RSS reader that displays your feed while Claude Code is processing, with non-intrusive notifications when Claude needs your attention.

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Claude Hook Integration](#3-claude-hook-integration)
4. [RSS Reader Server](#4-rss-reader-server)
5. [RSS Reader Client UI](#5-rss-reader-client-ui)
6. [Provider System](#6-provider-system)
7. [Notification System](#7-notification-system)
8. [Configuration](#8-configuration)
9. [Development Setup](#9-development-setup)
10. [Future Enhancements](#10-future-enhancements)

---

## 1. Project Overview

### Problem Statement

When using Claude Code, there are periods of waiting while Claude processes requests. During this time, users often context-switch to other activities. The challenge is:

1. Making productive use of waiting time (reading RSS feeds)
2. Knowing when Claude is ready without constantly checking back

### Solution

A decoupled system with two components:

1. **Standalone RSS Reader** - A local web app that displays RSS feeds from various sources
2. **Claude Hook** - A lightweight hook that notifies the reader when Claude finishes

### Design Principles

- **Non-intrusive**: Reader continues uninterrupted; notifications are subtle
- **Pluggable**: Support multiple RSS providers (Readwise, generic RSS, etc.)
- **Lightweight**: Minimal overhead on Claude Code's performance
- **Offline-capable**: Cache feeds for offline reading

---

## 2. Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Machine                           │
│                                                                 │
│  ┌─────────────────┐          ┌─────────────────────────────┐  │
│  │   Claude Code   │          │      RSS Reader App         │  │
│  │                 │          │      (localhost:3847)       │  │
│  │  ┌───────────┐  │   HTTP   │  ┌───────────────────────┐  │  │
│  │  │ Stop Hook │──┼──────────┼─▶│  /api/claude-ready    │  │  │
│  │  └───────────┘  │   POST   │  └───────────────────────┘  │  │
│  │                 │          │            │                │  │
│  │  ┌───────────┐  │          │            ▼                │  │
│  │  │Notification│──┼──────────┼─▶│  SSE Event Stream     │  │  │
│  │  │   Hook    │  │          │  └───────────────────────┘  │  │
│  │  └───────────┘  │          │            │                │  │
│  └─────────────────┘          │            ▼                │  │
│                               │  ┌───────────────────────┐  │  │
│                               │  │   Browser Client      │  │  │
│                               │  │   - Shows RSS feed    │  │  │
│                               │  │   - Receives events   │  │  │
│                               │  │   - Shows notification│  │  │
│                               │  └───────────────────────┘  │  │
│                               │                             │  │
│                               │  ┌───────────────────────┐  │  │
│                               │  │   Provider Layer      │  │  │
│                               │  │   - Readwise          │  │  │
│                               │  │   - Generic RSS       │  │  │
│                               │  │   - Miniflux, etc.    │  │  │
│                               │  └───────────────────────┘  │  │
│                               └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
claude-rss-reader/
├── PLAN.md                     # This document
├── README.md                   # User-facing documentation
├── package.json                # Project dependencies
├── tsconfig.json               # TypeScript configuration
│
├── src/
│   ├── server/                 # Backend server
│   │   ├── index.ts            # Entry point, Express/Hono app
│   │   ├── routes/
│   │   │   ├── api.ts          # REST API routes
│   │   │   └── sse.ts          # Server-Sent Events endpoint
│   │   ├── services/
│   │   │   ├── feed.ts         # Feed fetching & caching logic
│   │   │   ├── notification.ts # Notification broadcasting
│   │   │   └── cache.ts        # In-memory/persistent cache
│   │   └── config.ts           # Server configuration loader
│   │
│   ├── providers/              # RSS provider implementations
│   │   ├── types.ts            # Provider interface definitions
│   │   ├── index.ts            # Provider registry & factory
│   │   ├── readwise.ts         # Readwise Reader API provider
│   │   ├── rss.ts              # Generic RSS/Atom provider
│   │   ├── miniflux.ts         # Miniflux API provider
│   │   └── feedbin.ts          # Feedbin API provider
│   │
│   ├── client/                 # Frontend (if using build step)
│   │   ├── index.html          # Main HTML page
│   │   ├── app.ts              # Client-side application
│   │   ├── components/         # UI components
│   │   │   ├── FeedList.ts     # Feed item list
│   │   │   ├── FeedItem.ts     # Individual feed item
│   │   │   └── Notification.ts # Notification toast
│   │   └── styles/
│   │       └── main.css        # Styles
│   │
│   └── shared/                 # Shared types & utilities
│       ├── types.ts            # Shared type definitions
│       └── constants.ts        # Shared constants
│
├── claude-hook/                # Claude Code hook files
│   ├── install.sh              # Hook installation script
│   ├── notify-ready.sh         # Shell script for Stop hook
│   └── settings.example.json   # Example Claude settings
│
├── config/
│   └── default.json            # Default configuration
│
└── tests/
    ├── providers/              # Provider unit tests
    ├── server/                 # Server integration tests
    └── e2e/                    # End-to-end tests
```

### Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Server | Hono + Node.js | Lightweight, fast, TypeScript-native |
| Client | Vanilla JS + HTMX | Simple, no build step for basic version |
| Styling | Tailwind CSS | Rapid prototyping, small bundle |
| Cache | SQLite (better-sqlite3) | Persistent, no external deps |
| Testing | Vitest | Fast, TypeScript-native |

---

## 3. Claude Hook Integration

### Available Hook Events

Based on Claude Code's hook system, we'll use these events:

| Event | Purpose | Blocking |
|-------|---------|----------|
| `Stop` | Notify when Claude finishes processing | Yes (but we exit immediately) |
| `Notification` | Notify when Claude needs attention (permissions, etc.) | No |

### Hook Configuration

The hook will be configured in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://localhost:3847/api/claude-ready -H 'Content-Type: application/json' -d '{\"event\": \"stop\"}'",
            "timeout": 5
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt|idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://localhost:3847/api/claude-ready -H 'Content-Type: application/json' -d '{\"event\": \"attention_needed\"}'",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

### Hook Script (Alternative)

For more complex logic, use a script at `~/.claude/hooks/notify-reader.sh`:

```bash
#!/bin/bash
# Reads JSON from stdin, extracts event info, notifies reader

INPUT=$(cat)
EVENT_NAME=$(echo "$INPUT" | jq -r '.hook_event_name // "unknown"')

# Only notify if reader is running
if curl -s --connect-timeout 1 http://localhost:3847/health > /dev/null 2>&1; then
  curl -s -X POST http://localhost:3847/api/claude-ready \
    -H 'Content-Type: application/json' \
    -d "{\"event\": \"$EVENT_NAME\", \"timestamp\": $(date +%s)}"
fi

# Always exit 0 to not block Claude
exit 0
```

### Hook Data Flow

```
Claude Code                     Reader Server
    │                               │
    │ (Claude finishes)             │
    ▼                               │
Stop Hook fires                     │
    │                               │
    │ POST /api/claude-ready        │
    │ {"event": "stop"}             │
    ├──────────────────────────────▶│
    │                               │
    │                               ▼
    │                     Broadcast SSE event
    │                               │
    │                               ▼
    │                     Browser receives event
    │                               │
    │                               ▼
    │                     Show notification toast
```

### Installation Script

`claude-hook/install.sh`:

```bash
#!/bin/bash
# Installs Claude RSS Reader hooks

SETTINGS_FILE="$HOME/.claude/settings.json"
HOOK_SCRIPT="$HOME/.claude/hooks/notify-reader.sh"

# Create hooks directory
mkdir -p "$HOME/.claude/hooks"

# Copy hook script
cp "$(dirname "$0")/notify-ready.sh" "$HOOK_SCRIPT"
chmod +x "$HOOK_SCRIPT"

# Merge settings (requires jq)
if [ -f "$SETTINGS_FILE" ]; then
  # Backup existing settings
  cp "$SETTINGS_FILE" "$SETTINGS_FILE.backup"

  # Merge hooks (implementation depends on existing structure)
  echo "Existing settings found. Please manually add hooks from settings.example.json"
else
  cp "$(dirname "$0")/settings.example.json" "$SETTINGS_FILE"
  echo "Created new settings file with hooks configured"
fi

echo "Hook installation complete!"
```

---

## 4. RSS Reader Server

### Server Entry Point

`src/server/index.ts`:

```typescript
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

// Static files (client)
app.use('/*', serveStatic({ root: './public' }));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

serve({
  fetch: app.fetch,
  port: config.port,
}, (info) => {
  console.log(`RSS Reader running at http://localhost:${info.port}`);
});
```

### API Routes

`src/server/routes/api.ts`:

```typescript
import { Hono } from 'hono';
import { notificationService } from '../services/notification';
import { feedService } from '../services/feed';

const api = new Hono();

// Claude hook endpoint - receives notifications from Claude Code
api.post('/claude-ready', async (c) => {
  const body = await c.req.json();
  const event = body.event || 'ready';

  // Broadcast to all connected clients
  notificationService.broadcast({
    type: 'claude_ready',
    event,
    timestamp: Date.now(),
  });

  return c.json({ success: true });
});

// Get feed items
api.get('/feed', async (c) => {
  const provider = c.req.query('provider');
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');

  const items = await feedService.getItems({ provider, limit, offset });
  return c.json({ items, hasMore: items.length === limit });
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
```

### SSE (Server-Sent Events) Routes

`src/server/routes/sse.ts`:

```typescript
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
      await stream.writeSSE({
        event: 'heartbeat',
        data: JSON.stringify({ timestamp: Date.now() }),
      });
    }, 30000);

    // Cleanup on disconnect
    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    // Keep stream open
    await new Promise(() => {});
  });
});

export { sse as sseRoutes };
```

### Notification Service

`src/server/services/notification.ts`:

```typescript
type NotificationEvent = {
  type: string;
  event?: string;
  timestamp: number;
  [key: string]: unknown;
};

type Subscriber = (event: NotificationEvent) => Promise<void>;

class NotificationService {
  private subscribers = new Map<string, Subscriber>();

  subscribe(clientId: string, callback: Subscriber): () => void {
    this.subscribers.set(clientId, callback);

    return () => {
      this.subscribers.delete(clientId);
    };
  }

  async broadcast(event: NotificationEvent): Promise<void> {
    const promises = Array.from(this.subscribers.values()).map(
      (callback) => callback(event).catch(console.error)
    );

    await Promise.all(promises);
  }

  getClientCount(): number {
    return this.subscribers.size;
  }
}

export const notificationService = new NotificationService();
```

### Feed Service

`src/server/services/feed.ts`:

```typescript
import { FeedItem, Provider, ProviderConfig } from '../../shared/types';
import { createProvider } from '../../providers';
import { cacheService } from './cache';
import { loadConfig } from '../config';

class FeedService {
  private providers: Map<string, Provider> = new Map();
  private config = loadConfig();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    for (const [name, providerConfig] of Object.entries(this.config.providers)) {
      if (providerConfig.enabled) {
        const provider = createProvider(name, providerConfig);
        this.providers.set(name, provider);
      }
    }
  }

  async getItems(options: {
    provider?: string;
    limit: number;
    offset: number;
  }): Promise<FeedItem[]> {
    // Try cache first
    const cacheKey = `items:${options.provider || 'all'}:${options.offset}:${options.limit}`;
    const cached = cacheService.get<FeedItem[]>(cacheKey);

    if (cached && !this.isCacheStale(cacheKey)) {
      return cached;
    }

    // Fetch from providers
    let items: FeedItem[] = [];

    if (options.provider) {
      const provider = this.providers.get(options.provider);
      if (provider) {
        items = await provider.fetchItems(options.limit);
      }
    } else {
      // Fetch from all providers and merge
      const allItems = await Promise.all(
        Array.from(this.providers.values()).map(
          (p) => p.fetchItems(options.limit).catch(() => [])
        )
      );

      items = allItems
        .flat()
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .slice(options.offset, options.offset + options.limit);
    }

    // Update cache
    cacheService.set(cacheKey, items, this.config.cacheTTL);

    return items;
  }

  async getItem(id: string): Promise<FeedItem | null> {
    // Check cache
    const cached = cacheService.get<FeedItem>(`item:${id}`);
    if (cached) return cached;

    // Search providers
    for (const provider of this.providers.values()) {
      const item = await provider.getItem?.(id);
      if (item) {
        cacheService.set(`item:${id}`, item);
        return item;
      }
    }

    return null;
  }

  async markAsRead(id: string): Promise<void> {
    // Find which provider owns this item and mark as read
    for (const provider of this.providers.values()) {
      if (provider.markAsRead) {
        await provider.markAsRead(id).catch(() => {});
      }
    }
  }

  async refresh(): Promise<void> {
    cacheService.clear();

    for (const provider of this.providers.values()) {
      await provider.fetchItems(50).catch(console.error);
    }
  }

  getProviders(): { name: string; enabled: boolean }[] {
    return Array.from(this.providers.entries()).map(([name]) => ({
      name,
      enabled: true,
    }));
  }

  private isCacheStale(key: string): boolean {
    const meta = cacheService.getMeta(key);
    if (!meta) return true;

    return Date.now() - meta.createdAt > this.config.cacheTTL;
  }
}

export const feedService = new FeedService();
```

### Cache Service

`src/server/services/cache.ts`:

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

interface CacheMeta {
  createdAt: number;
  expiresAt: number;
}

class CacheService {
  private db: Database.Database;
  private memoryCache = new Map<string, { value: unknown; meta: CacheMeta }>();

  constructor() {
    const dbPath = path.join(os.homedir(), '.claude-rss-reader', 'cache.db');
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT,
        created_at INTEGER,
        expires_at INTEGER
      )
    `);

    // Clean expired entries on startup
    this.db.exec(`DELETE FROM cache WHERE expires_at < ${Date.now()}`);
  }

  get<T>(key: string): T | null {
    // Check memory cache first
    const memCached = this.memoryCache.get(key);
    if (memCached && memCached.meta.expiresAt > Date.now()) {
      return memCached.value as T;
    }

    // Check SQLite
    const stmt = this.db.prepare('SELECT value, expires_at FROM cache WHERE key = ?');
    const row = stmt.get(key) as { value: string; expires_at: number } | undefined;

    if (row && row.expires_at > Date.now()) {
      const value = JSON.parse(row.value);
      // Populate memory cache
      this.memoryCache.set(key, {
        value,
        meta: { createdAt: Date.now(), expiresAt: row.expires_at },
      });
      return value as T;
    }

    return null;
  }

  set<T>(key: string, value: T, ttlMs = 300000): void {
    const now = Date.now();
    const expiresAt = now + ttlMs;

    // Update memory cache
    this.memoryCache.set(key, {
      value,
      meta: { createdAt: now, expiresAt },
    });

    // Persist to SQLite
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO cache (key, value, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(key, JSON.stringify(value), now, expiresAt);
  }

  getMeta(key: string): CacheMeta | null {
    const cached = this.memoryCache.get(key);
    return cached?.meta || null;
  }

  clear(): void {
    this.memoryCache.clear();
    this.db.exec('DELETE FROM cache');
  }
}

export const cacheService = new CacheService();
```

---

## 5. RSS Reader Client UI

### HTML Structure

`public/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RSS Reader</title>
  <link rel="stylesheet" href="/styles/main.css">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📰</text></svg>">
</head>
<body>
  <div id="app">
    <!-- Notification toast (hidden by default) -->
    <div id="notification" class="notification hidden">
      <span class="notification-icon">🤖</span>
      <span class="notification-text">Claude is ready!</span>
      <button class="notification-dismiss" onclick="dismissNotification()">×</button>
    </div>

    <!-- Header -->
    <header class="header">
      <h1>📰 RSS Reader</h1>
      <div class="header-actions">
        <select id="provider-select">
          <option value="">All Sources</option>
        </select>
        <button id="refresh-btn" onclick="refreshFeed()">↻ Refresh</button>
      </div>
    </header>

    <!-- Feed list -->
    <main class="feed-container">
      <ul id="feed-list" class="feed-list">
        <!-- Items rendered here -->
      </ul>

      <div id="loading" class="loading hidden">Loading...</div>
      <div id="empty" class="empty hidden">No items to display</div>
    </main>

    <!-- Status bar -->
    <footer class="status-bar">
      <span id="connection-status">Connecting...</span>
      <span id="item-count">0 items</span>
    </footer>
  </div>

  <script src="/app.js"></script>
</body>
</html>
```

### Client JavaScript

`public/app.js`:

```javascript
// State
let items = [];
let eventSource = null;
let notificationTimeout = null;

// DOM elements
const feedList = document.getElementById('feed-list');
const providerSelect = document.getElementById('provider-select');
const notification = document.getElementById('notification');
const connectionStatus = document.getElementById('connection-status');
const itemCount = document.getElementById('item-count');
const loading = document.getElementById('loading');
const empty = document.getElementById('empty');

// Initialize
async function init() {
  await loadProviders();
  await loadFeed();
  connectSSE();

  // Provider change handler
  providerSelect.addEventListener('change', loadFeed);
}

// Load available providers
async function loadProviders() {
  try {
    const res = await fetch('/api/providers');
    const data = await res.json();

    data.providers.forEach(provider => {
      const option = document.createElement('option');
      option.value = provider.name;
      option.textContent = provider.name.charAt(0).toUpperCase() + provider.name.slice(1);
      providerSelect.appendChild(option);
    });
  } catch (err) {
    console.error('Failed to load providers:', err);
  }
}

// Load feed items
async function loadFeed() {
  loading.classList.remove('hidden');
  empty.classList.add('hidden');

  try {
    const provider = providerSelect.value;
    const url = `/api/feed?limit=50${provider ? `&provider=${provider}` : ''}`;
    const res = await fetch(url);
    const data = await res.json();

    items = data.items;
    renderFeed();
  } catch (err) {
    console.error('Failed to load feed:', err);
  } finally {
    loading.classList.add('hidden');
  }
}

// Render feed items
function renderFeed() {
  if (items.length === 0) {
    empty.classList.remove('hidden');
    feedList.innerHTML = '';
    itemCount.textContent = '0 items';
    return;
  }

  empty.classList.add('hidden');
  itemCount.textContent = `${items.length} items`;

  feedList.innerHTML = items.map(item => `
    <li class="feed-item ${item.read ? 'read' : ''}" data-id="${item.id}">
      <a href="${item.url}" target="_blank" rel="noopener" onclick="markAsRead('${item.id}')">
        <div class="feed-item-source">${escapeHtml(item.source)}</div>
        <div class="feed-item-title">${escapeHtml(item.title)}</div>
        ${item.summary ? `<div class="feed-item-summary">${escapeHtml(item.summary)}</div>` : ''}
        <div class="feed-item-meta">
          <time datetime="${item.publishedAt}">${formatDate(item.publishedAt)}</time>
        </div>
      </a>
    </li>
  `).join('');
}

// Connect to Server-Sent Events
function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/events');

  eventSource.addEventListener('connected', (e) => {
    connectionStatus.textContent = '● Connected';
    connectionStatus.classList.add('connected');
  });

  eventSource.addEventListener('claude_ready', (e) => {
    const data = JSON.parse(e.data);
    showNotification(data.event);
  });

  eventSource.addEventListener('heartbeat', () => {
    // Connection is alive
  });

  eventSource.onerror = () => {
    connectionStatus.textContent = '○ Disconnected';
    connectionStatus.classList.remove('connected');

    // Reconnect after delay
    setTimeout(connectSSE, 5000);
  };
}

// Show notification
function showNotification(event) {
  // Clear any existing timeout
  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
  }

  // Update notification text based on event type
  const textEl = notification.querySelector('.notification-text');
  if (event === 'stop') {
    textEl.textContent = 'Claude is ready!';
  } else if (event === 'attention_needed') {
    textEl.textContent = 'Claude needs your attention';
  } else {
    textEl.textContent = 'Claude notification';
  }

  // Show notification
  notification.classList.remove('hidden');
  notification.classList.add('show');

  // Play sound (optional)
  playNotificationSound();

  // Auto-dismiss after 10 seconds
  notificationTimeout = setTimeout(dismissNotification, 10000);
}

// Dismiss notification
function dismissNotification() {
  notification.classList.remove('show');
  notification.classList.add('hidden');

  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
    notificationTimeout = null;
  }
}

// Play notification sound
function playNotificationSound() {
  // Simple beep using Web Audio API
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.1;

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.15);
  } catch (err) {
    // Audio not supported
  }
}

// Mark item as read
async function markAsRead(id) {
  try {
    await fetch(`/api/feed/${id}/read`, { method: 'POST' });

    // Update local state
    const item = items.find(i => i.id === id);
    if (item) item.read = true;

    // Update UI
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) el.classList.add('read');
  } catch (err) {
    console.error('Failed to mark as read:', err);
  }
}

// Refresh feed
async function refreshFeed() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = '↻ Refreshing...';

  try {
    await fetch('/api/feed/refresh', { method: 'POST' });
    await loadFeed();
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Refresh';
  }
}

// Utility: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Utility: Format date
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

// Start app
init();
```

### Styles

`public/styles/main.css`:

```css
:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --bg-tertiary: #0f3460;
  --text-primary: #e6e6e6;
  --text-secondary: #a0a0a0;
  --accent: #e94560;
  --success: #4ade80;
  --border: #2a2a4a;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
}

#app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  max-width: 800px;
  margin: 0 auto;
}

/* Header */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg-primary);
  z-index: 10;
}

.header h1 {
  font-size: 1.25rem;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.header-actions select,
.header-actions button {
  padding: 0.5rem 0.75rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
}

.header-actions button:hover {
  background: var(--bg-tertiary);
}

/* Feed */
.feed-container {
  flex: 1;
  overflow-y: auto;
}

.feed-list {
  list-style: none;
}

.feed-item {
  border-bottom: 1px solid var(--border);
}

.feed-item a {
  display: block;
  padding: 1rem;
  color: inherit;
  text-decoration: none;
  transition: background 0.2s;
}

.feed-item a:hover {
  background: var(--bg-secondary);
}

.feed-item.read {
  opacity: 0.6;
}

.feed-item-source {
  font-size: 0.75rem;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.25rem;
}

.feed-item-title {
  font-size: 1rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
}

.feed-item-summary {
  font-size: 0.875rem;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.feed-item-meta {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

/* Notification */
.notification {
  position: fixed;
  top: 1rem;
  right: 1rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  transform: translateX(calc(100% + 2rem));
  transition: transform 0.3s ease;
  z-index: 100;
}

.notification.show {
  transform: translateX(0);
}

.notification.hidden {
  display: none;
}

.notification-icon {
  font-size: 1.5rem;
}

.notification-text {
  font-weight: 500;
}

.notification-dismiss {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.25rem;
}

.notification-dismiss:hover {
  color: var(--text-primary);
}

/* Status bar */
.status-bar {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
}

#connection-status.connected {
  color: var(--success);
}

/* States */
.loading,
.empty {
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary);
}

.hidden {
  display: none;
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}

::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--bg-tertiary);
}
```

---

## 6. Provider System

### Provider Interface

`src/providers/types.ts`:

```typescript
export interface FeedItem {
  id: string;
  title: string;
  url: string;
  source: string;
  summary?: string;
  content?: string;
  author?: string;
  publishedAt: Date;
  read: boolean;
  tags?: string[];
  imageUrl?: string;
  providerId: string;
}

export interface ProviderConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export interface Provider {
  name: string;

  /**
   * Fetch feed items from the provider
   */
  fetchItems(limit: number): Promise<FeedItem[]>;

  /**
   * Get a single item by ID (optional)
   */
  getItem?(id: string): Promise<FeedItem | null>;

  /**
   * Mark an item as read (optional)
   */
  markAsRead?(id: string): Promise<void>;

  /**
   * Test connection / validate credentials
   */
  testConnection(): Promise<boolean>;
}
```

### Provider Factory

`src/providers/index.ts`:

```typescript
import { Provider, ProviderConfig } from './types';
import { ReadwiseProvider } from './readwise';
import { RSSProvider } from './rss';
import { MinifluxProvider } from './miniflux';
import { FeedbinProvider } from './feedbin';

const providers: Record<string, new (config: ProviderConfig) => Provider> = {
  readwise: ReadwiseProvider,
  rss: RSSProvider,
  miniflux: MinifluxProvider,
  feedbin: FeedbinProvider,
};

export function createProvider(name: string, config: ProviderConfig): Provider {
  const ProviderClass = providers[name];

  if (!ProviderClass) {
    throw new Error(`Unknown provider: ${name}`);
  }

  return new ProviderClass(config);
}

export function getAvailableProviders(): string[] {
  return Object.keys(providers);
}
```

### Readwise Provider

`src/providers/readwise.ts`:

```typescript
import { Provider, ProviderConfig, FeedItem } from './types';

interface ReadwiseConfig extends ProviderConfig {
  token: string;
  location?: 'new' | 'later' | 'shortlist' | 'archive' | 'feed';
  category?: 'article' | 'email' | 'rss' | 'highlight' | 'note' | 'pdf' | 'epub' | 'tweet' | 'video';
}

interface ReadwiseDocument {
  id: string;
  title: string;
  url: string;
  source_url: string;
  author: string;
  summary: string;
  content: string;
  published_date: string;
  created_at: string;
  updated_at: string;
  first_opened_at: string | null;
  last_opened_at: string | null;
  location: string;
  category: string;
  tags: { name: string }[];
  image_url: string;
  site_name: string;
}

export class ReadwiseProvider implements Provider {
  name = 'readwise';
  private config: ReadwiseConfig;
  private baseUrl = 'https://readwise.io/api/v3';

  constructor(config: ProviderConfig) {
    this.config = config as ReadwiseConfig;

    if (!this.config.token) {
      throw new Error('Readwise token is required');
    }
  }

  private get headers(): HeadersInit {
    return {
      'Authorization': `Token ${this.config.token}`,
      'Content-Type': 'application/json',
    };
  }

  async fetchItems(limit: number): Promise<FeedItem[]> {
    const params = new URLSearchParams({
      limit: String(limit),
    });

    if (this.config.location) {
      params.set('location', this.config.location);
    }

    if (this.config.category) {
      params.set('category', this.config.category);
    }

    const response = await fetch(`${this.baseUrl}/list/?${params}`, {
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Readwise API error: ${response.status}`);
    }

    const data = await response.json();

    return data.results.map((doc: ReadwiseDocument) => this.transformDocument(doc));
  }

  async getItem(id: string): Promise<FeedItem | null> {
    const response = await fetch(`${this.baseUrl}/list/?id=${id}`, {
      headers: this.headers,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.results.length === 0) {
      return null;
    }

    return this.transformDocument(data.results[0]);
  }

  async markAsRead(id: string): Promise<void> {
    await fetch(`${this.baseUrl}/update/${id}/`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify({ seen: true }),
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch('https://readwise.io/api/v2/auth/', {
        headers: this.headers,
      });
      return response.status === 204;
    } catch {
      return false;
    }
  }

  private transformDocument(doc: ReadwiseDocument): FeedItem {
    return {
      id: `readwise:${doc.id}`,
      title: doc.title,
      url: doc.source_url || doc.url,
      source: doc.site_name || 'Readwise',
      summary: doc.summary,
      content: doc.content,
      author: doc.author,
      publishedAt: new Date(doc.published_date || doc.created_at),
      read: doc.first_opened_at !== null,
      tags: doc.tags?.map(t => t.name) || [],
      imageUrl: doc.image_url,
      providerId: this.name,
    };
  }
}
```

### Generic RSS Provider

`src/providers/rss.ts`:

```typescript
import Parser from 'rss-parser';
import { Provider, ProviderConfig, FeedItem } from './types';

interface RSSConfig extends ProviderConfig {
  feeds: string[];
  refreshInterval?: number;
}

interface ParsedItem {
  guid?: string;
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  creator?: string;
  isoDate?: string;
  pubDate?: string;
}

export class RSSProvider implements Provider {
  name = 'rss';
  private config: RSSConfig;
  private parser: Parser;
  private readItems = new Set<string>();

  constructor(config: ProviderConfig) {
    this.config = config as RSSConfig;
    this.parser = new Parser({
      timeout: 10000,
      headers: {
        'User-Agent': 'Claude-RSS-Reader/1.0',
      },
    });

    if (!this.config.feeds || this.config.feeds.length === 0) {
      throw new Error('At least one RSS feed URL is required');
    }
  }

  async fetchItems(limit: number): Promise<FeedItem[]> {
    const allItems: FeedItem[] = [];

    // Fetch all feeds in parallel
    const results = await Promise.allSettled(
      this.config.feeds.map(url => this.fetchFeed(url))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allItems.push(...result.value);
      } else {
        console.error('Failed to fetch feed:', result.reason);
      }
    }

    // Sort by date and limit
    return allItems
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, limit);
  }

  async markAsRead(id: string): Promise<void> {
    this.readItems.add(id);
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.parser.parseURL(this.config.feeds[0]);
      return true;
    } catch {
      return false;
    }
  }

  private async fetchFeed(url: string): Promise<FeedItem[]> {
    const feed = await this.parser.parseURL(url);
    const feedTitle = feed.title || new URL(url).hostname;

    return (feed.items || []).map((item: ParsedItem) => {
      const id = `rss:${this.hashString(item.guid || item.link || item.title || '')}`;

      return {
        id,
        title: item.title || 'Untitled',
        url: item.link || url,
        source: feedTitle,
        summary: item.contentSnippet?.slice(0, 300),
        content: item.content,
        author: item.creator,
        publishedAt: new Date(item.isoDate || item.pubDate || Date.now()),
        read: this.readItems.has(id),
        tags: [],
        providerId: this.name,
      };
    });
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}
```

### Miniflux Provider

`src/providers/miniflux.ts`:

```typescript
import { Provider, ProviderConfig, FeedItem } from './types';

interface MinifluxConfig extends ProviderConfig {
  baseUrl: string;
  apiKey: string;
}

interface MinifluxEntry {
  id: number;
  title: string;
  url: string;
  content: string;
  author: string;
  published_at: string;
  status: 'unread' | 'read' | 'removed';
  feed: {
    title: string;
    site_url: string;
  };
}

export class MinifluxProvider implements Provider {
  name = 'miniflux';
  private config: MinifluxConfig;

  constructor(config: ProviderConfig) {
    this.config = config as MinifluxConfig;

    if (!this.config.baseUrl || !this.config.apiKey) {
      throw new Error('Miniflux baseUrl and apiKey are required');
    }
  }

  private get headers(): HeadersInit {
    return {
      'X-Auth-Token': this.config.apiKey,
      'Content-Type': 'application/json',
    };
  }

  async fetchItems(limit: number): Promise<FeedItem[]> {
    const response = await fetch(
      `${this.config.baseUrl}/v1/entries?status=unread&limit=${limit}&direction=desc`,
      { headers: this.headers }
    );

    if (!response.ok) {
      throw new Error(`Miniflux API error: ${response.status}`);
    }

    const data = await response.json();

    return data.entries.map((entry: MinifluxEntry) => ({
      id: `miniflux:${entry.id}`,
      title: entry.title,
      url: entry.url,
      source: entry.feed.title,
      summary: this.extractSummary(entry.content),
      content: entry.content,
      author: entry.author,
      publishedAt: new Date(entry.published_at),
      read: entry.status === 'read',
      tags: [],
      providerId: this.name,
    }));
  }

  async markAsRead(id: string): Promise<void> {
    const entryId = id.replace('miniflux:', '');

    await fetch(`${this.config.baseUrl}/v1/entries`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({
        entry_ids: [parseInt(entryId)],
        status: 'read',
      }),
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/me`, {
        headers: this.headers,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private extractSummary(html: string): string {
    // Simple HTML tag stripping
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, 300);
  }
}
```

### Feedbin Provider

`src/providers/feedbin.ts`:

```typescript
import { Provider, ProviderConfig, FeedItem } from './types';

interface FeedbinConfig extends ProviderConfig {
  username: string;
  password: string;
}

interface FeedbinEntry {
  id: number;
  title: string;
  url: string;
  content: string;
  author: string;
  published: string;
  feed_id: number;
}

interface FeedbinFeed {
  id: number;
  title: string;
  site_url: string;
}

export class FeedbinProvider implements Provider {
  name = 'feedbin';
  private config: FeedbinConfig;
  private baseUrl = 'https://api.feedbin.com/v2';
  private feedCache = new Map<number, FeedbinFeed>();

  constructor(config: ProviderConfig) {
    this.config = config as FeedbinConfig;

    if (!this.config.username || !this.config.password) {
      throw new Error('Feedbin username and password are required');
    }
  }

  private get headers(): HeadersInit {
    const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
    return {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    };
  }

  async fetchItems(limit: number): Promise<FeedItem[]> {
    // Fetch unread entry IDs
    const unreadResponse = await fetch(`${this.baseUrl}/unread_entries.json`, {
      headers: this.headers,
    });

    if (!unreadResponse.ok) {
      throw new Error(`Feedbin API error: ${unreadResponse.status}`);
    }

    const unreadIds: number[] = await unreadResponse.json();
    const idsToFetch = unreadIds.slice(0, limit);

    if (idsToFetch.length === 0) {
      return [];
    }

    // Fetch entries
    const entriesResponse = await fetch(
      `${this.baseUrl}/entries.json?ids=${idsToFetch.join(',')}`,
      { headers: this.headers }
    );

    const entries: FeedbinEntry[] = await entriesResponse.json();

    // Fetch feed info for sources
    await this.populateFeedCache(entries.map(e => e.feed_id));

    return entries.map(entry => ({
      id: `feedbin:${entry.id}`,
      title: entry.title || 'Untitled',
      url: entry.url,
      source: this.feedCache.get(entry.feed_id)?.title || 'Unknown',
      summary: this.extractSummary(entry.content),
      content: entry.content,
      author: entry.author,
      publishedAt: new Date(entry.published),
      read: !unreadIds.includes(entry.id),
      tags: [],
      providerId: this.name,
    }));
  }

  async markAsRead(id: string): Promise<void> {
    const entryId = parseInt(id.replace('feedbin:', ''));

    await fetch(`${this.baseUrl}/unread_entries.json`, {
      method: 'DELETE',
      headers: this.headers,
      body: JSON.stringify({ unread_entries: [entryId] }),
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/authentication.json`, {
        headers: this.headers,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async populateFeedCache(feedIds: number[]): Promise<void> {
    const uncachedIds = feedIds.filter(id => !this.feedCache.has(id));

    if (uncachedIds.length === 0) return;

    const response = await fetch(`${this.baseUrl}/feeds.json`, {
      headers: this.headers,
    });

    const feeds: FeedbinFeed[] = await response.json();

    for (const feed of feeds) {
      this.feedCache.set(feed.id, feed);
    }
  }

  private extractSummary(html: string): string {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, 300);
  }
}
```

---

## 7. Notification System

### Notification Types

| Event | Source | Notification Style |
|-------|--------|-------------------|
| `stop` | Claude finished processing | Toast with sound |
| `attention_needed` | Claude needs permission/input | Prominent toast, persistent |

### Browser Notification API (Optional Enhancement)

Add system-level notifications for when the browser tab isn't visible:

```typescript
// In client app.js

async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function showSystemNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: 'claude-ready', // Prevents duplicate notifications
    });
  }
}

// Call when document is hidden
function showNotification(event) {
  // ... existing toast logic ...

  // Also show system notification if tab is hidden
  if (document.hidden) {
    if (event === 'stop') {
      showSystemNotification('Claude is ready!', 'Click to return to your terminal');
    } else if (event === 'attention_needed') {
      showSystemNotification('Claude needs attention', 'Permission or input required');
    }
  }
}
```

### Sound Options

Configurable notification sounds:

```typescript
// config option
{
  "notifications": {
    "sound": "chime" | "bell" | "none",
    "volume": 0.3
  }
}

// Implementation with different sounds
const sounds = {
  chime: [800, 0.15],   // frequency, duration
  bell: [600, 0.2],
  pop: [1000, 0.1],
};

function playNotificationSound(type = 'chime') {
  if (type === 'none') return;

  const [frequency, duration] = sounds[type] || sounds.chime;
  // ... Web Audio API implementation
}
```

---

## 8. Configuration

### Configuration Schema

`config/schema.ts`:

```typescript
export interface Config {
  // Server
  port: number;
  host: string;

  // Cache
  cacheTTL: number;  // milliseconds
  cacheDir: string;

  // Providers
  providers: {
    readwise?: {
      enabled: boolean;
      token: string;
      location?: 'new' | 'later' | 'shortlist' | 'archive' | 'feed';
      category?: string;
    };
    rss?: {
      enabled: boolean;
      feeds: string[];
    };
    miniflux?: {
      enabled: boolean;
      baseUrl: string;
      apiKey: string;
    };
    feedbin?: {
      enabled: boolean;
      username: string;
      password: string;
    };
  };

  // UI
  ui: {
    theme: 'dark' | 'light' | 'auto';
    itemsPerPage: number;
    showSummary: boolean;
  };

  // Notifications
  notifications: {
    sound: 'chime' | 'bell' | 'pop' | 'none';
    volume: number;
    autoDismiss: number;  // seconds, 0 = manual dismiss
    systemNotifications: boolean;
  };
}
```

### Default Configuration

`config/default.json`:

```json
{
  "port": 3847,
  "host": "127.0.0.1",

  "cacheTTL": 300000,
  "cacheDir": "~/.claude-rss-reader",

  "providers": {
    "readwise": {
      "enabled": false,
      "token": "",
      "location": "new"
    },
    "rss": {
      "enabled": false,
      "feeds": []
    }
  },

  "ui": {
    "theme": "dark",
    "itemsPerPage": 50,
    "showSummary": true
  },

  "notifications": {
    "sound": "chime",
    "volume": 0.3,
    "autoDismiss": 10,
    "systemNotifications": true
  }
}
```

### Configuration Loading

`src/server/config.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Config } from '../shared/types';
import defaultConfig from '../../config/default.json';

const CONFIG_PATHS = [
  path.join(os.homedir(), '.claude-rss-reader', 'config.json'),
  path.join(process.cwd(), 'config.json'),
];

export function loadConfig(): Config {
  let userConfig = {};

  for (const configPath of CONFIG_PATHS) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        userConfig = JSON.parse(content);
        console.log(`Loaded config from ${configPath}`);
        break;
      } catch (err) {
        console.error(`Failed to load config from ${configPath}:`, err);
      }
    }
  }

  // Deep merge with defaults
  return deepMerge(defaultConfig, userConfig) as Config;
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}
```

### Environment Variable Support

Support environment variables for secrets:

```typescript
function resolveValue(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('env:')) {
    const envVar = value.slice(4);
    return process.env[envVar] || '';
  }
  return value;
}

// In config
{
  "providers": {
    "readwise": {
      "token": "env:READWISE_TOKEN"
    }
  }
}
```

---

## 9. Development Setup

### Prerequisites

- Node.js 20+
- npm or pnpm

### Initial Setup

```bash
# Clone repository
git clone https://github.com/laniehei/claude-rss-reader.git
cd claude-rss-reader

# Install dependencies
npm install

# Copy example config
mkdir -p ~/.claude-rss-reader
cp config/default.json ~/.claude-rss-reader/config.json

# Edit config with your provider credentials
$EDITOR ~/.claude-rss-reader/config.json

# Start development server
npm run dev
```

### Package.json Scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/server/index.ts",
    "build": "tsc && npm run build:client",
    "build:client": "esbuild src/client/app.ts --bundle --minify --outfile=public/app.js",
    "start": "node dist/server/index.js",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "lint": "eslint src/",
    "hook:install": "bash claude-hook/install.sh"
  }
}
```

### Dependencies

```json
{
  "dependencies": {
    "hono": "^4.0.0",
    "@hono/node-server": "^1.8.0",
    "better-sqlite3": "^9.0.0",
    "rss-parser": "^3.13.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "tsx": "^4.0.0",
    "vitest": "^1.0.0",
    "@types/node": "^20.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "esbuild": "^0.20.0",
    "eslint": "^8.0.0"
  }
}
```

### Testing

```typescript
// tests/providers/readwise.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ReadwiseProvider } from '../../src/providers/readwise';

describe('ReadwiseProvider', () => {
  it('should transform documents correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        results: [{
          id: '123',
          title: 'Test Article',
          source_url: 'https://example.com/article',
          summary: 'Test summary',
          created_at: '2024-01-01T00:00:00Z',
          first_opened_at: null,
          site_name: 'Example',
          tags: [],
        }],
      }),
    });

    global.fetch = mockFetch;

    const provider = new ReadwiseProvider({
      enabled: true,
      token: 'test-token',
    });

    const items = await provider.fetchItems(10);

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Test Article');
    expect(items[0].read).toBe(false);
  });
});
```

---

## 10. Future Enhancements

### Phase 2: Enhanced Features

1. **Keyboard Navigation**
   - `j/k` to navigate items
   - `o` to open in browser
   - `m` to mark read
   - `r` to refresh

2. **Reading Mode**
   - Inline article viewing
   - Distraction-free reading
   - Font size controls

3. **Feed Organization**
   - Folders/categories
   - Search/filter
   - Save for later

### Phase 3: Advanced Integrations

1. **Additional Providers**
   - Inoreader
   - Feedly (OAuth)
   - NewsBlur
   - Pocket

2. **Two-Way Sync**
   - Sync read state back to providers
   - Cross-device state

3. **Claude Integration**
   - "Summarize this article" button
   - Send article to Claude for discussion

### Phase 4: Desktop App

1. **Tauri/Electron Wrapper**
   - Native menu bar icon
   - Global hotkeys
   - System tray

2. **Auto-Start**
   - Launch on login
   - Background running

---

## Implementation Priority

| Priority | Component | Rationale |
|----------|-----------|-----------|
| 1 | Server core + SSE | Foundation for everything |
| 2 | Claude hook | Core value proposition |
| 3 | Basic UI | Usable MVP |
| 4 | Readwise provider | User's primary source |
| 5 | Generic RSS provider | Broad compatibility |
| 6 | Configuration system | Customization |
| 7 | Caching | Performance |
| 8 | Additional providers | Extended support |

---

## Open Questions

1. **Port selection**: Default 3847 chosen to avoid conflicts. Should it be configurable via CLI arg?

2. **Multiple Claude instances**: If running multiple Claude Code sessions, should notifications aggregate or be per-session?

3. **Mobile support**: Should the UI be responsive for phone access on local network?

4. **Authentication**: Should the local server require auth for security on shared machines?
