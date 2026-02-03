#!/bin/bash
# Claude RSS Reader - Notification Hook
# This script is called by Claude Code hooks to notify the RSS reader

INPUT=$(cat)
EVENT_NAME=$(echo "$INPUT" | jq -r '.hook_event_name // "unknown"')

# Only notify if reader is running (silent fail if not)
if curl -s --connect-timeout 1 http://localhost:3847/health > /dev/null 2>&1; then
  curl -s -X POST http://localhost:3847/api/claude-ready \
    -H 'Content-Type: application/json' \
    -d "{\"event\": \"$EVENT_NAME\", \"timestamp\": $(date +%s)}" \
    > /dev/null 2>&1
fi

# Always exit 0 to not block Claude
exit 0
