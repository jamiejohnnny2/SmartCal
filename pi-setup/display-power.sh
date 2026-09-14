#!/usr/bin/env bash
# Turns the kiosk's Elo touchscreen's own power state on/off over its video
# cable — the Pi and the calendar app keep running the whole time either
# way; this only tells the MONITOR to sleep/wake, same as its own power
# button would.
#
# Backend defaults to DDC/CI (via ddcutil), not HDMI-CEC: Elo's spec sheet
# documents VESA DDC/CI support for power control on this display family,
# but says nothing about HDMI-CEC — and CEC is primarily a consumer-TV
# feature that a lot of commercial/open-frame monitors like this one don't
# implement at all. Confirm which one your actual unit responds to with the
# one-shot test commands in the README before wiring this into the
# always-on screen-wake service — this script can't verify that for you.
#
# Usage:
#   display-power.sh on
#   display-power.sh off
#
# Override the backend if you've confirmed CEC actually works on your unit:
#   DISPLAY_POWER_BACKEND=cec display-power.sh off
set -euo pipefail

BACKEND="${DISPLAY_POWER_BACKEND:-ddcutil}"
ACTION="${1:-}"

if [[ "$ACTION" != "on" && "$ACTION" != "off" ]]; then
  echo "Usage: $0 on|off" >&2
  exit 1
fi

case "$BACKEND" in
  ddcutil)
    # VCP feature D6 = "Power Mode" in the VESA MCCS spec: 01 = on,
    # 05 = off (soft power down). If 05 doesn't do anything on your unit,
    # `ddcutil capabilities` will show what values D6 actually supports —
    # some displays only honor 04 (DPM off / suspend) instead.
    if [[ "$ACTION" == "on" ]]; then
      ddcutil setvcp D6 01
    else
      ddcutil setvcp D6 05
    fi
    ;;
  cec)
    # Requires v4l-utils (cec-ctl), not the older/unmaintained cec-client —
    # see the README for why. `0` is the TV/sink's logical CEC address.
    if [[ "$ACTION" == "on" ]]; then
      cec-ctl --to 0 --image-view-on
    else
      cec-ctl --to 0 --standby
    fi
    ;;
  *)
    echo "Unknown DISPLAY_POWER_BACKEND: $BACKEND (expected ddcutil or cec)" >&2
    exit 1
    ;;
esac
