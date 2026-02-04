import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

// Server imports
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';

const CONFIG_DIR = path.join(os.homedir(), '.valeria');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, 'settings.json');

const args = process.argv.slice(2);
const command = args[0] || 'start';

// ============ NOTIFICATION SERVICE ============
type NotificationEvent = { type: string; event?: string; timestamp: number; [key: string]: unknown };
type Subscriber = (event: NotificationEvent) => Promise<void>;

class NotificationService {
  private subscribers = new Map<string, Subscriber>();

  subscribe(clientId: string, callback: Subscriber): () => void {
    this.subscribers.set(clientId, callback);
    return () => { this.subscribers.delete(clientId); };
  }

  async broadcast(event: NotificationEvent): Promise<void> {
    const promises = Array.from(this.subscribers.values()).map((cb) => cb(event).catch(console.error));
    await Promise.all(promises);
  }

  getClientCount(): number { return this.subscribers.size; }
}

const notificationService = new NotificationService();

// ============ CONFIG ============
function loadConfig(): any {
  const defaults = { port: 3847, host: '127.0.0.1', cacheTTL: 300000, providers: {} };

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      return { ...defaults, ...userConfig };
    } catch { /* ignore */ }
  }
  return defaults;
}

// ============ PROVIDERS ============
interface FeedItem {
  id: string; title: string; url: string; source: string; summary?: string;
  author?: string; publishedAt: Date; read: boolean; tags?: string[]; providerId: string;
}

interface Provider {
  name: string;
  fetchItems(limit: number): Promise<FeedItem[]>;
  markAsRead?(id: string): Promise<void>;
}

class ReadwiseProvider implements Provider {
  name = 'readwise';
  private token: string;

  constructor(config: any) {
    this.token = config.token;
    if (!this.token) throw new Error('Readwise token required');
  }

  async fetchItems(limit: number): Promise<FeedItem[]> {
    const res = await fetch(`https://readwise.io/api/v3/list/?limit=${limit}`, {
      headers: { Authorization: `Token ${this.token}` },
    });
    if (!res.ok) throw new Error(`Readwise API error: ${res.status}`);
    const data: any = await res.json();
    return (data.results || []).map((doc: any) => ({
      id: `readwise:${doc.id}`,
      title: doc.title || 'Untitled',
      url: doc.source_url || doc.url,
      source: doc.site_name || 'Readwise',
      summary: doc.summary,
      author: doc.author,
      publishedAt: new Date(doc.published_date || doc.created_at),
      read: doc.first_opened_at !== null,
      tags: doc.tags ? Object.keys(doc.tags) : [],
      providerId: this.name,
    }));
  }

  async markAsRead(id: string): Promise<void> {
    const docId = id.replace('readwise:', '');
    await fetch(`https://readwise.io/api/v3/update/${docId}/`, {
      method: 'PATCH',
      headers: { Authorization: `Token ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ seen: true }),
    });
  }
}

// ============ FEED SERVICE ============
class FeedService {
  private providers: Map<string, Provider> = new Map();
  private cache: Map<string, { items: FeedItem[]; timestamp: number }> = new Map();
  private config: any;

  constructor() {
    this.config = loadConfig();
    this.initProviders();
  }

  private initProviders() {
    const providers = this.config.providers || {};
    if (providers.readwise?.enabled && providers.readwise.token) {
      try {
        this.providers.set('readwise', new ReadwiseProvider(providers.readwise));
        console.log('Initialized provider: readwise');
      } catch (e) { console.error('Failed to init readwise:', e); }
    }
  }

  async getItems(opts: { provider?: string; limit: number; offset: number }): Promise<FeedItem[]> {
    const cacheKey = `items:${opts.provider || 'all'}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < (this.config.cacheTTL || 300000)) {
      return cached.items.slice(opts.offset, opts.offset + opts.limit);
    }

    let items: FeedItem[] = [];
    if (opts.provider) {
      const p = this.providers.get(opts.provider);
      if (p) items = await p.fetchItems(100);
    } else {
      const all = await Promise.all(
        Array.from(this.providers.values()).map((p) => p.fetchItems(100).catch(() => []))
      );
      items = all.flat().sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    }

    this.cache.set(cacheKey, { items, timestamp: Date.now() });
    return items.slice(opts.offset, opts.offset + opts.limit);
  }

  async markAsRead(id: string): Promise<void> {
    for (const p of this.providers.values()) {
      if (p.markAsRead && id.startsWith(`${p.name}:`)) {
        await p.markAsRead(id).catch(console.error);
        break;
      }
    }
  }

  async refresh(): Promise<void> { this.cache.clear(); }
  getProviders(): { name: string; enabled: boolean }[] {
    return Array.from(this.providers.keys()).map((n) => ({ name: n, enabled: true }));
  }
}

// ============ SERVER ============
async function startServer() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log('No configuration found. Running setup...\n');
    await runSetup();
    return;
  }

  const config = loadConfig();
  const feedService = new FeedService();
  const app = new Hono();

  app.use('/*', cors());

  // API routes
  app.post('/api/claude-ready', async (c) => {
    let event = 'ready';
    try { const b = await c.req.json(); event = b.event || 'ready'; } catch {}
    await notificationService.broadcast({ type: 'claude_ready', event, timestamp: Date.now() });
    console.log(`Claude notification: ${event} (${notificationService.getClientCount()} clients)`);
    return c.json({ success: true });
  });

  app.get('/api/feed', async (c) => {
    const provider = c.req.query('provider');
    const limit = parseInt(c.req.query('limit') || '20');
    const offset = parseInt(c.req.query('offset') || '0');
    try {
      const items = await feedService.getItems({ provider, limit, offset });
      return c.json({ items, hasMore: items.length === limit });
    } catch (e) {
      console.error('Feed error:', e);
      return c.json({ items: [], hasMore: false });
    }
  });

  app.post('/api/feed/:id/read', async (c) => {
    await feedService.markAsRead(c.req.param('id'));
    return c.json({ success: true });
  });

  app.post('/api/feed/refresh', async (c) => {
    await feedService.refresh();
    return c.json({ success: true });
  });

  app.get('/api/providers', (c) => c.json({ providers: feedService.getProviders() }));

  // SSE
  app.get('/events', async (c) => {
    return streamSSE(c, async (stream) => {
      const clientId = crypto.randomUUID();
      const unsub = notificationService.subscribe(clientId, async (event) => {
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });
      await stream.writeSSE({ event: 'connected', data: JSON.stringify({ clientId, timestamp: Date.now() }) });
      const hb = setInterval(async () => {
        try { await stream.writeSSE({ event: 'heartbeat', data: JSON.stringify({ timestamp: Date.now() }) }); }
        catch { clearInterval(hb); }
      }, 30000);
      stream.onAbort(() => { clearInterval(hb); unsub(); });
      await new Promise(() => {});
    });
  });

  app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

  // Static files
  const publicDir = path.join(process.cwd(), 'public');
  if (fs.existsSync(publicDir)) {
    app.use('/*', serveStatic({ root: './public' }));
  }

  const port = config.port || 3847;
  serve({ fetch: app.fetch, port, hostname: config.host || '127.0.0.1' }, () => {
    console.log(`
╭─────────────────────────────────────────╮
│                                         │
│   📰 Valeria RSS Reader                 │
│                                         │
│   Running at http://127.0.0.1:${port}     │
│                                         │
│   Open in browser to view your feeds    │
│   Claude will notify you when ready!    │
│                                         │
╰─────────────────────────────────────────╯
`);
  });
}

// ============ CLI COMMANDS ============
async function main() {
  switch (command) {
    case 'start': await startServer(); break;
    case 'setup': await runSetup(); break;
    case 'hooks': await installHooks(); break;
    case 'status': await checkStatus(); break;
    case 'help': case '--help': case '-h': printHelp(); break;
    default: console.error(`Unknown command: ${command}`); printHelp(); process.exit(1);
  }
}

function printHelp() {
  console.log(`
📰 Valeria RSS Reader

Usage: valeria [command]

Commands:
  start     Start the RSS reader server (default)
  setup     Interactive configuration setup
  hooks     Install Claude Code hooks
  status    Check server and config status
  help      Show this help message

Examples:
  valeria              # Start server
  valeria setup        # Configure providers
  valeria hooks        # Install Claude hooks
`);
}

async function runSetup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

  console.log('📰 Valeria RSS Reader Setup\n');

  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

  let config: any = { port: 3847, providers: {} };
  if (fs.existsSync(CONFIG_FILE)) {
    try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch {}
  }

  console.log('─── Readwise Reader ───');
  const setupReadwise = await question('Configure Readwise Reader? (Y/n): ');
  if (setupReadwise.toLowerCase() !== 'n') {
    const token = await question('Readwise API token (from readwise.io/access_token): ');
    if (token.trim()) {
      config.providers.readwise = { enabled: true, token: token.trim() };
      console.log('✓ Readwise configured\n');
    }
  }

  const portStr = await question(`Server port (${config.port || 3847}): `);
  if (portStr.trim()) config.port = parseInt(portStr.trim()) || 3847;

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log(`\n✓ Configuration saved to ${CONFIG_FILE}`);

  const installHooksNow = await question('\nInstall Claude Code hooks now? (Y/n): ');
  rl.close();
  if (installHooksNow.toLowerCase() !== 'n') await installHooks();
  console.log('\n✓ Setup complete! Run `valeria` to start.');
}

async function installHooks() {
  console.log('📌 Installing Claude Code hooks...\n');
  if (!fs.existsSync(CLAUDE_DIR)) fs.mkdirSync(CLAUDE_DIR, { recursive: true });

  let settings: any = {};
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    try { settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf-8')); console.log('Found existing Claude settings'); } catch {}
  }

  const rssHooks: any = {
    Stop: [{ hooks: [{ type: 'command', command: 'curl -s -X POST http://localhost:3847/api/claude-ready -H "Content-Type: application/json" -d \'{"event":"stop"}\'', timeout: 5 }] }],
    Notification: [{ matcher: 'permission_prompt|idle_prompt', hooks: [{ type: 'command', command: 'curl -s -X POST http://localhost:3847/api/claude-ready -H "Content-Type: application/json" -d \'{"event":"attention_needed"}\'', timeout: 5 }] }],
  };

  const existingHooks = settings.hooks || {};
  for (const [event, hookConfigs] of Object.entries(rssHooks)) {
    if (!existingHooks[event]) existingHooks[event] = [];
    const exists = existingHooks[event].some((h: any) => h.hooks?.some((i: any) => i.command?.includes('localhost:3847')));
    if (!exists) { existingHooks[event].push(...(hookConfigs as any[])); console.log(`✓ Added ${event} hook`); }
    else console.log(`○ ${event} hook already exists`);
  }

  settings.hooks = existingHooks;
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
  console.log(`\n✓ Hooks saved to ${CLAUDE_SETTINGS}`);
}

async function checkStatus() {
  console.log('📰 Valeria RSS Reader Status\n');

  console.log('─── Configuration ───');
  if (fs.existsSync(CONFIG_FILE)) {
    console.log(`✓ Config: ${CONFIG_FILE}`);
    try {
      const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      const providers = Object.entries(c.providers || {}).filter(([_, v]: any) => v.enabled).map(([k]) => k);
      console.log(`  Providers: ${providers.length > 0 ? providers.join(', ') : 'none'}`);
    } catch { console.log('  (invalid JSON)'); }
  } else console.log('✗ Config: not found');

  console.log('\n─── Claude Hooks ───');
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    try {
      const s = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf-8'));
      const has = s.hooks?.Stop?.some((h: any) => h.hooks?.some((i: any) => i.command?.includes('localhost:3847')));
      console.log(`${has ? '✓' : '✗'} Stop hook: ${has ? 'installed' : 'not installed'}`);
    } catch { console.log('✗ Could not read Claude settings'); }
  } else console.log('✗ Claude settings: not found');

  console.log('\n─── Server ───');
  try {
    const r = await fetch('http://localhost:3847/health');
    console.log(r.ok ? '✓ Server: running' : '✗ Server: not responding');
  } catch { console.log('✗ Server: not running'); }
}

main().catch(console.error);
