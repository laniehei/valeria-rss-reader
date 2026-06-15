import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';

// Server imports (lazy-loaded for fast CLI startup)
let Hono: any, serve: any, cors: any, serveStatic: any, streamSSE: any;
async function loadServerDeps() {
  ({ Hono } = await import('hono'));
  ({ serve } = await import('@hono/node-server'));
  ({ cors } = await import('hono/cors'));
  ({ serveStatic } = await import('@hono/node-server/serve-static'));
  ({ streamSSE } = await import('hono/streaming'));
}

import { startPager, loadCachedArticles, saveCachedArticles, loadState, saveState, stripHtml } from './pager';

// Get directory of this script (works with ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  id: string; title: string; url: string; source: string; summary?: string; content?: string;
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
      content: doc.html || doc.content || doc.summary,
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

// Generic RSS/Atom feed provider
class RSSProvider implements Provider {
  name: string;
  private feeds: { name: string; url: string }[];

  constructor(name: string, feeds: { name: string; url: string }[]) {
    this.name = name;
    this.feeds = feeds;
  }

  async fetchItems(limit: number): Promise<FeedItem[]> {
    const allItems: FeedItem[] = [];

    for (const feed of this.feeds) {
      try {
        const items = await this.fetchFeed(feed);
        allItems.push(...items);
      } catch (e) {
        console.error(`Failed to fetch ${feed.name}:`, e);
      }
    }

    return allItems
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, limit);
  }

  private async fetchFeed(feed: { name: string; url: string }): Promise<FeedItem[]> {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'Valeria RSS Reader/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();

    // Detect feed type and parse
    if (xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"')) {
      return this.parseAtom(xml, feed.name);
    } else {
      return this.parseRSS(xml, feed.name);
    }
  }

  private parseRSS(xml: string, sourceName: string): FeedItem[] {
    const items: FeedItem[] = [];
    const channelTitle = this.extractTag(xml, 'channel', 'title') || sourceName;

    // Extract all <item> elements
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const title = this.extractTag(itemXml, null, 'title') || 'Untitled';
      const link = this.extractTag(itemXml, null, 'link') || '';
      const description = this.extractTag(itemXml, null, 'description') || '';
      const content = this.extractTag(itemXml, null, 'content:encoded') || '';
      const pubDate = this.extractTag(itemXml, null, 'pubDate') || '';
      const author = this.extractTag(itemXml, null, 'author') || this.extractTag(itemXml, null, 'dc:creator') || '';
      const guid = this.extractTag(itemXml, null, 'guid') || link || title;

      items.push({
        id: `rss:${this.hashString(guid)}`,
        title: this.decodeEntities(title),
        url: link,
        source: channelTitle,
        summary: this.stripHtml(this.decodeEntities(description)).slice(0, 300),
        content: content || description,
        author: this.decodeEntities(author),
        publishedAt: pubDate ? new Date(pubDate) : new Date(),
        read: false,
        providerId: this.name,
      } as FeedItem);
    }
    return items;
  }

  private parseAtom(xml: string, sourceName: string): FeedItem[] {
    const items: FeedItem[] = [];
    const feedTitle = this.extractTag(xml, 'feed', 'title') || sourceName;

    // Extract all <entry> elements
    const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
    let match;
    while ((match = entryRegex.exec(xml)) !== null) {
      const entryXml = match[1];
      const title = this.extractTag(entryXml, null, 'title') || 'Untitled';
      const link = this.extractAtomLink(entryXml);
      const summary = this.extractTag(entryXml, null, 'summary') || '';
      const content = this.extractTag(entryXml, null, 'content') || '';
      const updated = this.extractTag(entryXml, null, 'updated') || this.extractTag(entryXml, null, 'published') || '';
      const author = this.extractTag(entryXml, 'author', 'name') || '';
      const id = this.extractTag(entryXml, null, 'id') || link || title;

      items.push({
        id: `rss:${this.hashString(id)}`,
        title: this.decodeEntities(title),
        url: link,
        source: feedTitle,
        summary: this.stripHtml(this.decodeEntities(summary)).slice(0, 300),
        content: content || summary,
        author: this.decodeEntities(author),
        publishedAt: updated ? new Date(updated) : new Date(),
        read: false,
        providerId: this.name,
      } as FeedItem);
    }
    return items;
  }

  private extractTag(xml: string, parent: string | null, tag: string): string | null {
    let searchXml = xml;
    if (parent) {
      const parentMatch = new RegExp(`<${parent}[^>]*>([\\s\\S]*?)<\\/${parent}>`, 'i').exec(xml);
      if (parentMatch) searchXml = parentMatch[1];
      else return null;
    }
    // Handle CDATA
    const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, 'i');
    const cdataMatch = cdataRegex.exec(searchXml);
    if (cdataMatch) return cdataMatch[1].trim();

    // Handle regular content
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = regex.exec(searchXml);
    return match ? match[1].trim() : null;
  }

  private extractAtomLink(xml: string): string {
    // Look for <link rel="alternate" href="..."> or just <link href="...">
    const altMatch = /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(xml);
    if (altMatch) return altMatch[1];
    const hrefMatch = /<link[^>]*href=["']([^"']+)["']/i.exec(xml);
    return hrefMatch ? hrefMatch[1] : '';
  }

  private decodeEntities(text: string): string {
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
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

    // Readwise provider
    if (providers.readwise?.enabled && providers.readwise.token) {
      try {
        this.providers.set('readwise', new ReadwiseProvider(providers.readwise));
        console.log('Initialized provider: readwise');
      } catch (e) { console.error('Failed to init readwise:', e); }
    }

    // RSS feeds provider
    if (providers.rss?.feeds && providers.rss.feeds.length > 0) {
      try {
        this.providers.set('rss', new RSSProvider('rss', providers.rss.feeds));
        console.log(`Initialized provider: rss (${providers.rss.feeds.length} feeds)`);
      } catch (e) { console.error('Failed to init rss:', e); }
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

  await loadServerDeps();
  const config = loadConfig();
  const feedService = new FeedService();
  const app = new Hono();

  app.use('/*', cors());

  // API routes
  app.post('/api/claude-ready', async (c) => {
    let event = 'ready';
    let cwd = '';
    let project = '';
    try {
      const b = await c.req.json();
      event = b.event || 'ready';
      cwd = b.cwd || '';
      // Extract project name from path (last directory)
      project = cwd ? cwd.split('/').filter(Boolean).pop() || '' : '';
    } catch {}
    await notificationService.broadcast({ type: 'claude_ready', event, cwd, project, timestamp: Date.now() });
    console.log(`Claude notification: ${event} ${project ? `(${project})` : ''} (${notificationService.getClientCount()} clients)`);
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
  // Serve static files from the package's public directory
  const publicDir = path.join(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    app.use('/*', serveStatic({ root: publicDir }));
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

// ============ TERMINAL READER ============
async function readArticles() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log('No configuration found. Run: valeria setup');
    process.exit(1);
  }

  const feedService = new FeedService();
  let articles: FeedItem[];
  try {
    articles = await feedService.getItems({ limit: 50, offset: 0 });
  } catch {
    articles = loadCachedArticles() as FeedItem[];
  }

  if (articles.length > 0) {
    saveCachedArticles(articles as any);
  } else {
    articles = loadCachedArticles() as FeedItem[];
  }

  if (articles.length === 0) {
    console.log('No articles found. Check your feed configuration: valeria setup');
    process.exit(1);
  }

  await startPager(articles as any);
}

async function feedArticle(direction?: string) {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log('No configuration found. Run: valeria setup');
    process.exit(1);
  }

  const feedService = new FeedService();
  let articles: FeedItem[];
  try {
    articles = await feedService.getItems({ limit: 50, offset: 0 });
    if (articles.length > 0) saveCachedArticles(articles as any);
  } catch {
    articles = loadCachedArticles() as FeedItem[];
  }
  if (articles.length === 0) {
    articles = loadCachedArticles() as FeedItem[];
  }
  if (articles.length === 0) {
    console.log('No articles found. Check your feed configuration: valeria setup');
    process.exit(1);
  }

  const state = loadState();
  let idx = Math.min(state.articleIndex, articles.length - 1);

  if (direction === 'next') {
    idx = Math.min(idx + 1, articles.length - 1);
  } else if (direction === 'prev') {
    idx = Math.max(idx - 0, 0);
  }

  const article = articles[idx];
  const text = stripHtml(article.content || article.summary || 'No content available.');

  console.log(`# ${article.title}\n`);
  console.log(`*${article.source}${article.author ? ' - ' + article.author : ''} - ${new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}*\n`);
  console.log(text);
  console.log(`\n---`);
  console.log(`Article ${idx + 1} of ${articles.length} | ${article.url}`);

  const readIds = [...new Set([...state.readIds, article.id])].slice(-200);
  saveState({ articleIndex: idx, page: 0, readIds });
}

async function showHint() {
  try {
    const articles = loadCachedArticles();
    const stateFile = path.join(os.homedir(), '.valeria', 'reading-state.json');
    let readIds: string[] = [];
    try {
      readIds = JSON.parse(fs.readFileSync(stateFile, 'utf-8')).readIds || [];
    } catch {}
    const readSet = new Set(readIds);
    const unread = articles.filter(a => !readSet.has(a.id)).length;
    if (unread > 0) {
      console.log(`\x1b[2m📰 ${unread} unread article${unread === 1 ? '' : 's'}. Type /read to read while waiting.\x1b[0m`);
    }
  } catch {
    // Silent - don't interfere with Claude
  }
}

async function hookRead() {
  let prompt = '';
  try {
    const input = fs.readFileSync(0, 'utf-8');
    const parsed = JSON.parse(input);
    prompt = parsed.prompt || '';
  } catch {}

  if (!prompt.trim().startsWith('/read')) {
    process.exit(0);
  }

  const parts = prompt.trim().split(/\s+/);
  const direction = parts[1] || undefined;

  if (!fs.existsSync(CONFIG_FILE)) {
    process.stderr.write('No configuration found. Run: valeria setup\n');
    process.exit(2);
  }

  const feedService = new FeedService();
  let articles: FeedItem[];
  try {
    articles = await feedService.getItems({ limit: 50, offset: 0 });
    if (articles.length > 0) saveCachedArticles(articles as any);
  } catch {
    articles = loadCachedArticles() as FeedItem[];
  }
  if (articles.length === 0) {
    articles = loadCachedArticles() as FeedItem[];
  }
  if (articles.length === 0) {
    process.stderr.write('No articles found. Run: valeria setup\n');
    process.exit(2);
  }

  const state = loadState();
  let idx = Math.min(state.articleIndex, articles.length - 1);

  if (direction === 'next') {
    idx = Math.min(idx + 1, articles.length - 1);
  } else if (direction === 'prev') {
    idx = Math.max(idx - 1, 0);
  }

  const article = articles[idx];
  const text = stripHtml(article.content || article.summary || 'No content available.');
  const date = new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const output = [
    '',
    `  \x1b[1m${article.title}\x1b[0m`,
    `  \x1b[2m${article.source}${article.author ? ' - ' + article.author : ''} - ${date}\x1b[0m`,
    `  \x1b[2m${'─'.repeat(60)}\x1b[0m`,
    ...text.split('\n').map((line: string) => `  ${line}`),
    '',
    `  \x1b[2mArticle ${idx + 1}/${articles.length} | ${article.url}\x1b[0m`,
    `  \x1b[2mType /read next or /read prev to navigate\x1b[0m`,
    '',
  ].join('\n');

  process.stderr.write(output);

  const readIds = [...new Set([...state.readIds, article.id])].slice(-200);
  saveState({ articleIndex: idx, page: 0, readIds });

  process.exit(2);
}

async function sendNotify() {
  const projectName = path.basename(process.cwd());
  try {
    const { execSync } = await import('child_process');
    if (process.platform === 'darwin') {
      execSync(
        `terminal-notifier -title "Valeria" -message "Claude is ready — ${projectName}" -sound default 2>/dev/null || true`,
        { stdio: 'ignore' },
      );
    }
  } catch {
    // Silent
  }
}

// ============ CLI COMMANDS ============
async function main() {
  switch (command) {
    case 'start': await startServer(); break;
    case 'read': await readArticles(); break;
    case 'feed': await feedArticle(args[1]); break;
    case 'hook-read': await hookRead(); break;
    case 'hint': await showHint(); break;
    case 'notify': await sendNotify(); break;
    case 'setup': await runSetup(); break;
    case 'hooks': await installHooks(); break;
    case 'status': await checkStatus(); break;
    case 'help': case '--help': case '-h': printHelp(); break;
    default: console.error(`Unknown command: ${command}`); printHelp(); process.exit(1);
  }
}

function printHelp() {
  console.log(`
Valeria RSS Reader

Usage: valeria [command]

Commands:
  start     Start the web-based RSS reader server (default)
  read      Read articles in terminal pager (use while Claude works)
  setup     Interactive configuration setup
  hooks     Install Claude Code hooks
  status    Check server and config status
  hint      Show unread count hint (used by PreToolUse hook)
  notify    Send desktop notification (used by Stop hook)
  help      Show this help message

Examples:
  valeria              # Start web server
  valeria read         # Terminal pager (! valeria read while Claude works)
  valeria setup        # Configure providers
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

  console.log('─── RSS Feeds ───');
  const setupRSS = await question('Configure RSS feeds? (Y/n): ');
  if (setupRSS.toLowerCase() !== 'n') {
    if (!config.providers.rss) config.providers.rss = { feeds: [] };
    console.log('Add RSS feeds (enter empty URL to finish):');
    while (true) {
      const url = await question('  Feed URL: ');
      if (!url.trim()) break;
      const name = await question('  Feed name: ');
      config.providers.rss.feeds.push({ name: name.trim() || url.trim(), url: url.trim() });
      console.log(`  ✓ Added ${name.trim() || url.trim()}\n`);
    }
    if (config.providers.rss.feeds.length > 0) {
      console.log(`✓ ${config.providers.rss.feeds.length} RSS feed(s) configured\n`);
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
    Stop: [{ hooks: [{ type: 'command', command: 'curl -s -X POST http://localhost:3847/api/claude-ready -H "Content-Type: application/json" -d "{\\"event\\":\\"stop\\",\\"cwd\\":\\"$(pwd)\\"}"', timeout: 5 }] }],
    Notification: [{ matcher: 'permission_prompt|idle_prompt', hooks: [{ type: 'command', command: 'curl -s -X POST http://localhost:3847/api/claude-ready -H "Content-Type: application/json" -d "{\\"event\\":\\"attention_needed\\",\\"cwd\\":\\"$(pwd)\\"}"', timeout: 5 }] }],
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
