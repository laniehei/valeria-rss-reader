import type { Provider, ProviderConfig } from './types';
import { ReadwiseProvider } from './readwise';
import { RSSProvider } from './rss';

const providerClasses: Record<string, new (config: ProviderConfig) => Provider> = {
  readwise: ReadwiseProvider,
  rss: RSSProvider,
};

export function createProvider(name: string, config: ProviderConfig): Provider {
  const ProviderClass = providerClasses[name];

  if (!ProviderClass) {
    throw new Error(`Unknown provider: ${name}`);
  }

  return new ProviderClass(config);
}

export function getAvailableProviders(): string[] {
  return Object.keys(providerClasses);
}
