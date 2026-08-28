#!/usr/bin/env bash
# Launches Chromium full-screen against the Smart Calendar server, with the
# screen kept awake and the mouse cursor hidden. Meant to be run from the
# desktop autostart on boot (see README.md).
set -euo pipefail

URL="http://localhost:3001"

# Give the smart-calendar systemd service a moment to come up on boot.
for _ in $(seq 1 30); do
  if curl -fs "$URL/api/health" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Disable screen blanking / DPMS power-down.
xset s off
xset s noblank
xset -dpms

# Hide the mouse cursor when idle.
unclutter -idle 0.5 -root &

chromium-browser \
  --noerrdialogs \
  --disable-infobars \
  --kiosk \
  --incognito \
  --no-first-run \
  --disable-translate \
  --overscroll-history-navigation=0 \
  --disable-pinch \
  "$URL"
