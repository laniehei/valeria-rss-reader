/**
 * Shared type definitions for Claude RSS Reader
 */

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
  fetchItems(limit: number): Promise<FeedItem[]>;
  getItem?(id: string): Promise<FeedItem | null>;
  markAsRead?(id: string): Promise<void>;
  testConnection(): Promise<boolean>;
}

export interface Config {
  port: number;
  host: string;
  cacheTTL: number;
  cacheDir: string;
  providers: Record<string, ProviderConfig>;
  ui: {
    theme: 'dark' | 'light' | 'auto';
    itemsPerPage: number;
    showSummary: boolean;
  };
  notifications: {
    sound: 'chime' | 'bell' | 'pop' | 'none';
    volume: number;
    autoDismiss: number;
    systemNotifications: boolean;
  };
}

export interface NotificationEvent {
  type: string;
  event?: string;
  timestamp: number;
  [key: string]: unknown;
}
