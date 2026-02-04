import type { FeedItem, Provider, ProviderConfig } from '../../shared/types';
import { createProvider } from '../../providers';
import { loadConfig } from '../config';

class FeedService {
  private providers: Map<string, Provider> = new Map();
  private config = loadConfig();
  private cache: Map<string, { items: FeedItem[]; timestamp: number }> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    const providersConfig = this.config.providers || {};

    for (const [name, providerConfig] of Object.entries(providersConfig)) {
      const config = providerConfig as ProviderConfig;
      if (config.enabled) {
        try {
          const provider = createProvider(name, config);
          this.providers.set(name, provider);
          console.log(`Initialized provider: ${name}`);
        } catch (err) {
          console.error(`Failed to initialize provider ${name}:`, err);
        }
      }
    }

    if (this.providers.size === 0) {
      console.warn('No providers enabled. Configure providers in ~/.claude-rss-reader/config.json');
    }
  }

  async getItems(options: {
    provider?: string;
    limit: number;
    offset: number;
  }): Promise<FeedItem[]> {
    const cacheKey = `items:${options.provider || 'all'}`;
    const cached = this.cache.get(cacheKey);
    const cacheTTL = this.config.cacheTTL || 300000;

    // Return cached items if fresh
    if (cached && Date.now() - cached.timestamp < cacheTTL) {
      return cached.items.slice(options.offset, options.offset + options.limit);
    }

    // Fetch from providers
    let items: FeedItem[] = [];

    if (options.provider) {
      const provider = this.providers.get(options.provider);
      if (provider) {
        items = await provider.fetchItems(100);
      }
    } else {
      // Fetch from all providers and merge
      const allItems = await Promise.all(
        Array.from(this.providers.values()).map((p) =>
          p.fetchItems(100).catch((err) => {
            console.error(`Provider ${p.name} failed:`, err);
            return [];
          })
        )
      );

      items = allItems
        .flat()
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    }

    // Update cache
    this.cache.set(cacheKey, { items, timestamp: Date.now() });

    return items.slice(options.offset, options.offset + options.limit);
  }

  async getItem(id: string): Promise<FeedItem | null> {
    // Check cache first
    for (const cached of this.cache.values()) {
      const item = cached.items.find((i) => i.id === id);
      if (item) return item;
    }

    // Search providers
    for (const provider of this.providers.values()) {
      if (provider.getItem) {
        const item = await provider.getItem(id);
        if (item) return item;
      }
    }

    return null;
  }

  async markAsRead(id: string): Promise<void> {
    // Find which provider owns this item and mark as read
    for (const provider of this.providers.values()) {
      if (provider.markAsRead && id.startsWith(`${provider.name}:`)) {
        await provider.markAsRead(id).catch(console.error);
        break;
      }
    }

    // Update cache
    for (const cached of this.cache.values()) {
      const item = cached.items.find((i) => i.id === id);
      if (item) {
        item.read = true;
      }
    }
  }

  async refresh(): Promise<void> {
    this.cache.clear();

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
}

export const feedService = new FeedService();
