/**
 * Provider-specific type definitions
 * Re-exports core types and adds provider implementation details
 */

export type { FeedItem, Provider, ProviderConfig } from '../shared/types';

// Readwise-specific types
export interface ReadwiseConfig {
  enabled: boolean;
  token: string;
  location?: 'new' | 'later' | 'shortlist' | 'archive' | 'feed';
  category?: 'article' | 'email' | 'rss' | 'highlight' | 'note' | 'pdf' | 'epub' | 'tweet' | 'video';
}

export interface ReadwiseDocument {
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
  tags: Record<string, unknown>;
  image_url: string;
  site_name: string;
}

// RSS-specific types
export interface RSSConfig {
  enabled: boolean;
  feeds: string[];
  refreshInterval?: number;
}

// Miniflux-specific types
export interface MinifluxConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
}

export interface MinifluxEntry {
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

// Feedbin-specific types
export interface FeedbinConfig {
  enabled: boolean;
  username: string;
  password: string;
}

export interface FeedbinEntry {
  id: number;
  title: string;
  url: string;
  content: string;
  author: string;
  published: string;
  feed_id: number;
}

export interface FeedbinFeed {
  id: number;
  title: string;
  site_url: string;
}
