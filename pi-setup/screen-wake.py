#!/usr/bin/env python3
"""
Camera-based motion sensor for the Smart Calendar kiosk's screen power.

The camera's only job on this kiosk is presence detection, not gesture
control (navigation is touch or voice only) — this just answers "has
anything moved in front of the camera recently at all", about as reliable
as a dedicated PIR motion sensor for that purpose, without needing new
hardware.

Behavior: the screen turns off after --idle-timeout seconds with no motion,
and back on the moment motion is seen again.

This has NOT been tested against a real camera or the display-power.sh
backend it calls (no hardware available while building this) — the motion
threshold below is a reasonable starting point but may need tuning once you
can watch real detections. Run with --debug to print every frame's motion
reading and every on/off transition.

Usage:
    python3 screen-wake.py --idle-timeout 600
    python3 screen-wake.py --camera 0 --debug
"""

import argparse
import subprocess
import sys
import time

# Deliberately low-res capture, since this only needs to answer "did
# anything move", not track anything precisely.
CAPTURE_WIDTH = 320
CAPTURE_HEIGHT = 240
CAPTURE_FPS = 5  # motion-only detection doesn't need a high frame rate

MOTION_AREA_MIN = 1500  # min moving-pixel count (post-blur) to count as "motion"
MIN_ON_DURATION_S = 5.0  # don't allow an off-trigger this soon after turning on,
# in case the wake-triggering motion itself is still settling in frame


def set_display_power(script_dir, state, debug=False):
    script = script_dir / "display-power.sh"
    try:
        # Invoked via bash explicitly rather than relying on the file's own
        # executable bit, which doesn't reliably survive a repo edited from
        # Windows (this one is, per its git history).
        subprocess.run(["bash", str(script), state], check=True)
        print(f"[screen-wake] display -> {state}")
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"[screen-wake] failed to set display {state}: {exc}", file=sys.stderr)
    if debug:
        print(f"[debug] set_display_power({state})")


def run(camera_index, idle_timeout, script_dir, debug):
    import cv2  # imported here so this stays importable without opencv for --help

    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        print(f"Could not open camera index {camera_index}", file=sys.stderr)
        sys.exit(1)

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAPTURE_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAPTURE_HEIGHT)
    cap.set(cv2.CAP_PROP_FPS, CAPTURE_FPS)
    actual_w = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
    actual_h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    print(f"Camera {camera_index}: {actual_w:.0f}x{actual_h:.0f}, idle timeout {idle_timeout}s")

    bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=200, varThreshold=40, detectShadows=False)

    screen_on = True
    now = time.time()
    last_motion_at = now
    turned_on_at = now

    print("Watching for motion — screen assumed ON at startup")

    while True:
        ok, frame = cap.read()
        if not ok:
            print("Camera read failed, retrying...", file=sys.stderr)
            time.sleep(0.5)
            continue

        mask = bg_subtractor.apply(frame)
        mask = cv2.medianBlur(mask, 5)
        motion_px = cv2.countNonZero(mask)
        now = time.time()
        motion = motion_px >= MOTION_AREA_MIN

        if debug:
            print(f"[debug] motion_px={motion_px} motion={motion} screen_on={screen_on}")

        if motion:
            last_motion_at = now
            if not screen_on:
                set_display_power(script_dir, "on", debug=debug)
                screen_on = True
                turned_on_at = now
        elif screen_on and (now - last_motion_at) > idle_timeout and (now - turned_on_at) > MIN_ON_DURATION_S:
            set_display_power(script_dir, "off", debug=debug)
            screen_on = False


def main():
    from pathlib import Path

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--camera", type=int, default=0, help="OpenCV camera index (default 0)")
    parser.add_argument(
        "--idle-timeout",
        type=float,
        default=600,
        help="Seconds of no motion before the screen is turned off (default 600 = 10 minutes)",
    )
    parser.add_argument("--debug", action="store_true", help="Print every frame's motion reading and transitions")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    run(args.camera, args.idle_timeout, script_dir, args.debug)


if __name__ == "__main__":
    main()
