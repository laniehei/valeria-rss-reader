# Valeria RSS Reader

Read your RSS feeds while Claude thinks. Get notified when Claude is ready.

## Install

```bash
npm install -g valeria-rss-reader
```

## Setup

```bash
valeria setup
```

This will:
1. Configure your RSS providers (Readwise, etc.)
2. Install Claude Code hooks

## Usage

```bash
valeria
```

Then open http://localhost:3847 in your browser.

## How it works

```
Claude Code                     Valeria (localhost:3847)
    │                               │
    │ (Claude finishes)             │
    ▼                               │
Stop Hook fires ──────────────────▶ SSE broadcast
                                    │
                                    ▼
                              Browser notification
```

1. Run `valeria` to start the local server
2. Open the RSS reader in your browser
3. Work with Claude Code
4. When Claude finishes, a hook pings the server
5. Your browser shows a notification

## Commands

```
valeria          # Start the server (default)
valeria setup    # Configure providers + install hooks
valeria hooks    # Reinstall Claude Code hooks
valeria status   # Check config and server status
valeria help     # Show help
```

## Configuration

Config is stored at `~/.valeria/config.json`:

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

## License

MIT
