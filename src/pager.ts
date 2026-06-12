/**
 * Terminal pager for reading RSS articles inline.
 * Uses alternate screen buffer and /dev/tty for input,
 * so it works even when stdin is piped (e.g., from a hook).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const STATE_DIR = path.join(os.homedir(), '.valeria');
const STATE_FILE = path.join(STATE_DIR, 'reading-state.json');
const CACHE_FILE = path.join(STATE_DIR, 'cache', 'articles.json');

interface ReadingState {
  articleIndex: number;
  page: number;
  readIds: string[];
}

interface Article {
  id: string;
  title: string;
  source: string;
  content?: string;
  summary?: string;
  publishedAt: string | Date;
  url: string;
  author?: string;
}

export function loadState(): ReadingState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { articleIndex: 0, page: 0, readIds: [] };
  }
}

export function saveState(state: ReadingState) {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function loadCachedArticles(): Article[] {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveCachedArticles(articles: Article[]) {
  const cacheDir = path.join(STATE_DIR, 'cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(articles.slice(0, 100)));
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '  - ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wordWrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine.length === 0) {
      lines.push('');
      continue;
    }
    const words = rawLine.split(/\s+/);
    let current = '';
    for (const word of words) {
      if (current.length + word.length + 1 > width) {
        lines.push(current);
        current = word;
      } else {
        current = current ? current + ' ' + word : word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function paginate(lines: string[], pageHeight: number): string[][] {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += pageHeight) {
    pages.push(lines.slice(i, i + pageHeight));
  }
  return pages.length > 0 ? pages : [['']];
}

function formatDate(d: string | Date): string {
  try {
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function renderScreen(
  article: Article,
  pages: string[][],
  pageIndex: number,
  articleIndex: number,
  totalArticles: number,
  width: number,
  height: number,
): string {
  const bar = '━'.repeat(width);
  const thinBar = '─'.repeat(width);

  const header = [
    `\x1b[1m${article.title}\x1b[0m`,
    `\x1b[2m${article.source}${article.author ? ' · ' + article.author : ''} · ${formatDate(article.publishedAt)}\x1b[0m`,
    thinBar,
  ];

  const statusLeft = `Article ${articleIndex + 1}/${totalArticles}`;
  const statusRight = `Page ${pageIndex + 1}/${pages.length}`;
  const statusKeys = 'Space:next  ↑:prev  n:next-article  p:prev-article  q:quit';
  const statusLine = `\x1b[7m ${statusLeft}${' '.repeat(Math.max(0, width - statusLeft.length - statusRight.length - 2))}${statusRight} \x1b[0m`;
  const keysLine = `\x1b[2m${statusKeys}\x1b[0m`;

  const contentHeight = height - header.length - 3;
  const page = pages[pageIndex] || [];
  const content = page.slice(0, contentHeight);

  while (content.length < contentHeight) {
    content.push('');
  }

  const lines = [
    ...header,
    ...content,
    statusLine,
    keysLine,
  ];

  return '\x1b[H\x1b[2J' + lines.join('\n');
}

export async function startPager(articles: Article[]): Promise<void> {
  if (articles.length === 0) {
    console.log('No articles to read. Configure feeds with: valeria setup');
    return;
  }

  const state = loadState();
  let articleIndex = Math.min(state.articleIndex, articles.length - 1);
  let pageIndex = state.page;

  // Open /dev/tty for input (works when stdin is piped)
  let ttyFd: number;
  let ttyReadStream: fs.ReadStream;
  try {
    ttyFd = fs.openSync('/dev/tty', 'r');
    ttyReadStream = fs.createReadStream('', { fd: ttyFd });
  } catch {
    // Fallback to stdin if /dev/tty not available
    ttyReadStream = process.stdin as unknown as fs.ReadStream;
  }

  const getSize = (): { width: number; height: number } => {
    try {
      const cols = process.stdout.columns || 80;
      const rows = process.stdout.rows || 24;
      return { width: Math.min(cols, 120), height: rows };
    } catch {
      return { width: 80, height: 24 };
    }
  };

  const buildPages = (article: Article, width: number, height: number): string[][] => {
    const text = stripHtml(article.content || article.summary || 'No content available.');
    const lines = wordWrap(text, width - 2);
    const contentHeight = height - 6;
    return paginate(lines, contentHeight);
  };

  // Enter alternate screen, hide cursor
  process.stdout.write('\x1b[?1049h\x1b[?25l');

  let pages = buildPages(articles[articleIndex], getSize().width, getSize().height);
  if (pageIndex >= pages.length) pageIndex = 0;

  const draw = () => {
    const { width, height } = getSize();
    pages = buildPages(articles[articleIndex], width, height);
    if (pageIndex >= pages.length) pageIndex = pages.length - 1;
    process.stdout.write(renderScreen(
      articles[articleIndex], pages, pageIndex,
      articleIndex, articles.length, width, height,
    ));
  };

  draw();

  process.stdout.on('resize', draw);

  // Enable raw mode on the tty stream
  if (typeof (ttyReadStream as any).setRawMode === 'function') {
    (ttyReadStream as any).setRawMode(true);
  }

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      if (typeof (ttyReadStream as any).setRawMode === 'function') {
        (ttyReadStream as any).setRawMode(false);
      }
      process.stdout.removeListener('resize', draw);
      // Leave alternate screen, show cursor
      process.stdout.write('\x1b[?25h\x1b[?1049l');
      // Save state
      const readIds = [...new Set([...state.readIds, articles[articleIndex].id])].slice(-200);
      saveState({ articleIndex, page: pageIndex, readIds });
      resolve();
    };

    ttyReadStream.on('data', (data: Buffer) => {
      const key = data.toString();

      // q or Ctrl-C: quit
      if (key === 'q' || key === '\x03') {
        cleanup();
        ttyReadStream.destroy();
        return;
      }

      // Space or Down or j: next page
      if (key === ' ' || key === '\x1b[B' || key === 'j') {
        if (pageIndex < pages.length - 1) {
          pageIndex++;
        } else if (articleIndex < articles.length - 1) {
          articleIndex++;
          pageIndex = 0;
        }
        draw();
        return;
      }

      // Up or k: prev page
      if (key === '\x1b[A' || key === 'k') {
        if (pageIndex > 0) {
          pageIndex--;
          draw();
        }
        return;
      }

      // n: next article
      if (key === 'n') {
        if (articleIndex < articles.length - 1) {
          const readIds = [...new Set([...state.readIds, articles[articleIndex].id])];
          state.readIds = readIds.slice(-200);
          articleIndex++;
          pageIndex = 0;
          draw();
        }
        return;
      }

      // p: prev article
      if (key === 'p') {
        if (articleIndex > 0) {
          articleIndex--;
          pageIndex = 0;
          draw();
        }
        return;
      }

      // Page Down
      if (key === '\x1b[6~') {
        if (pageIndex < pages.length - 1) {
          pageIndex++;
          draw();
        }
        return;
      }

      // Page Up
      if (key === '\x1b[5~') {
        if (pageIndex > 0) {
          pageIndex--;
          draw();
        }
        return;
      }
    });

    ttyReadStream.on('end', cleanup);
    ttyReadStream.on('error', cleanup);
  });
}
