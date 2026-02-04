import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Config } from '../shared/types';

const CONFIG_PATHS = [
  path.join(os.homedir(), '.claude-rss-reader', 'config.json'),
  path.join(process.cwd(), 'config.json'),
];

function resolveEnvValue(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('env:')) {
    const envVar = value.slice(4);
    return process.env[envVar] || '';
  }
  return value;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
      result[key] = deepMerge(
        (targetValue as Record<string, unknown>) || {},
        sourceValue as Record<string, unknown>
      );
    } else {
      result[key] = resolveEnvValue(sourceValue);
    }
  }

  return result;
}

function resolveAllEnvValues(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = resolveAllEnvValues(value as Record<string, unknown>);
    } else {
      result[key] = resolveEnvValue(value);
    }
  }

  return result;
}

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  // Load default config
  const defaultConfigPath = path.join(process.cwd(), 'config', 'default.json');
  let config: Record<string, unknown> = {};

  if (fs.existsSync(defaultConfigPath)) {
    config = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf-8'));
  }

  // Load user config
  for (const configPath of CONFIG_PATHS) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const userConfig = JSON.parse(content);
        config = deepMerge(config, userConfig);
        console.log(`Loaded config from ${configPath}`);
        break;
      } catch (err) {
        console.error(`Failed to load config from ${configPath}:`, err);
      }
    }
  }

  // Resolve any remaining env values
  config = resolveAllEnvValues(config);

  cachedConfig = config as unknown as Config;
  return cachedConfig;
}

export function getConfigPath(): string {
  return path.join(os.homedir(), '.claude-rss-reader', 'config.json');
}
