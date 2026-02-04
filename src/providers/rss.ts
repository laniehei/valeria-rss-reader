import Parser from 'rss-parser';
import type { Provider, ProviderConfig, FeedItem, RSSConfig } from './types';

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
    this.config = config as unknown as RSSConfig;
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
      this.config.feeds.map((url) => this.fetchFeed(url))
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

  async getItem(id: string): Promise<FeedItem | null> {
    // RSS items are fetched in bulk, not individually
    return null;
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
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}
