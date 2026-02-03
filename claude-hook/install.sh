#!/bin/bash
# Claude RSS Reader - Hook Installation Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

echo "Installing Claude RSS Reader hooks..."

# Create directories
mkdir -p "$HOOKS_DIR"

# Copy hook script
cp "$SCRIPT_DIR/notify-ready.sh" "$HOOKS_DIR/notify-ready.sh"
chmod +x "$HOOKS_DIR/notify-ready.sh"
echo "✓ Installed hook script to $HOOKS_DIR/notify-ready.sh"

# Check for existing settings
if [ -f "$SETTINGS_FILE" ]; then
  echo ""
  echo "⚠ Existing settings.json found at $SETTINGS_FILE"
  echo "  Please manually merge the hooks from:"
  echo "  $SCRIPT_DIR/settings.example.json"
  echo ""
  echo "  Add these hooks to your settings.json:"
  echo ""
  cat "$SCRIPT_DIR/settings.example.json"
  echo ""
else
  cp "$SCRIPT_DIR/settings.example.json" "$SETTINGS_FILE"
  echo "✓ Created settings.json with hooks configured"
fi

echo ""
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "1. Start the RSS reader: cd $(dirname "$SCRIPT_DIR") && npm run dev"
echo "2. Open http://localhost:3847 in your browser"
echo "3. Claude will notify you when it's ready!"
