import type { Provider, ProviderConfig, FeedItem, ReadwiseConfig, ReadwiseDocument } from './types';

interface ReadwiseResponse {
  results: ReadwiseDocument[];
  nextPageCursor?: string;
}

export class ReadwiseProvider implements Provider {
  name = 'readwise';
  private config: ReadwiseConfig;
  private baseUrl = 'https://readwise.io/api/v3';

  constructor(config: ProviderConfig) {
    this.config = config as unknown as ReadwiseConfig;

    if (!this.config.token) {
      throw new Error('Readwise token is required');
    }
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Token ${this.config.token}`,
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

    const data = (await response.json()) as ReadwiseResponse;

    return (data.results || []).map((doc: ReadwiseDocument) => this.transformDocument(doc));
  }

  async getItem(id: string): Promise<FeedItem | null> {
    const docId = id.replace('readwise:', '');

    const response = await fetch(`${this.baseUrl}/list/?id=${docId}`, {
      headers: this.headers,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as ReadwiseResponse;

    if (!data.results || data.results.length === 0) {
      return null;
    }

    return this.transformDocument(data.results[0]);
  }

  async markAsRead(id: string): Promise<void> {
    const docId = id.replace('readwise:', '');

    await fetch(`${this.baseUrl}/update/${docId}/`, {
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
      title: doc.title || 'Untitled',
      url: doc.source_url || doc.url,
      source: doc.site_name || 'Readwise',
      summary: doc.summary,
      content: doc.content,
      author: doc.author,
      publishedAt: new Date(doc.published_date || doc.created_at),
      read: doc.first_opened_at !== null,
      tags: doc.tags?.map((t) => t.name) || [],
      imageUrl: doc.image_url,
      providerId: this.name,
    };
  }
}
