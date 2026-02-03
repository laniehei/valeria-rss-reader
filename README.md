# Claude RSS Reader

A standalone RSS reader that displays your feeds while Claude Code is processing, with notifications when Claude needs your attention.

## Features

- **Decoupled design**: Reader runs independently, Claude just sends notifications
- **Pluggable providers**: Readwise, generic RSS/Atom, Miniflux, Feedbin
- **Non-intrusive**: Continue reading, get notified when Claude is ready
- **Local-first**: Runs on localhost, your data stays on your machine

## Quick Start

```bash
# Install dependencies
npm install

# Configure your providers
cp config/default.json ~/.claude-rss-reader/config.json
# Edit ~/.claude-rss-reader/config.json with your API tokens

# Install Claude hooks
npm run hook:install

# Start the reader
npm run dev

# Open http://localhost:3847
```

## Architecture

```
Claude Code                     RSS Reader (localhost:3847)
    │                               │
    │ (Claude finishes)             │
    ▼                               │
Stop Hook fires ──────────────────▶ SSE broadcast
                                    │
                                    ▼
                              Browser notification
```

## Configuration

Edit `~/.claude-rss-reader/config.json`:

```json
{
  "providers": {
    "readwise": {
      "enabled": true,
      "token": "your-readwise-token"
    }
  }
}
```

See [PLAN.md](./PLAN.md) for detailed documentation.

## License

MIT
