#!/usr/bin/env python3
"""
Camera-based swipe gesture detector for the Smart Calendar kiosk.

Watches the camera feed for a hand/arm moving decisively across the frame
and posts the resulting direction to the calendar server's /api/gesture
endpoint — the exact same endpoint a touch swipe drives internally, so a
detected gesture behaves identically to swiping the screen.

Deliberately NOT using a deep-learning hand-tracking model (MediaPipe etc.):
plain background-subtraction + blob-centroid tracking is far cheaper on a
Pi's CPU and is enough to reliably tell "something swept left/right/up/down
across the frame" from ambient motion, which is all a swipe gesture needs.

This has NOT been tested against a real camera (no hardware available while
building this) — the thresholds below (motion area, swipe distance, timing)
are reasonable starting points but will very likely need tuning once you can
see real detections. Run with --debug to print every candidate gesture and
why it was or wasn't accepted, and use --simulate to test the HTTP call to
the server independent of the camera entirely.

Usage:
    python3 gesture-swipe.py --server http://localhost:3001
    python3 gesture-swipe.py --camera 0 --debug
    python3 gesture-swipe.py --simulate up      # no camera needed

Setup:
    pip install -r requirements.txt
"""

import argparse
import math
import sys
import time
from collections import deque

import requests

# Deliberately low-res: this is blob-centroid tracking, not anything that
# benefits from detail, and background subtraction + contour finding cost
# scales with pixel count. Keeping capture small matters on a Pi that's also
# running the kiosk's Node server and Chromium. Not every camera/driver
# honors requested resolution/FPS — run() logs what it actually got so
# that's easy to spot rather than silently eating more CPU than expected.
CAPTURE_WIDTH = 320
CAPTURE_HEIGHT = 240
CAPTURE_FPS = 15

# The thresholds below are sized for the CAPTURE_WIDTH/HEIGHT above — if you
# change those, these should scale roughly with pixel count (area) or frame
# width (linear distances).
MOTION_AREA_MIN = 1000  # min contour area (px^2) to count as "something moved"
MAX_JUMP_PX = 200  # if the tracked point jumps further than this between frames,
# treat it as a different object (e.g. someone walked behind the swiper) and
# start a fresh track rather than let two unrelated motions blend into one.
SWIPE_MIN_DISPLACEMENT_PX = 120  # net movement required along the dominant axis
SWIPE_MAX_WINDOW_S = 1.2  # a swipe must complete within this long
GESTURE_COOLDOWN_S = 1.0  # ignore new gestures for this long after firing one
AXIS_DOMINANCE_RATIO = 1.5  # dominant axis must beat the other by at least this much


def post_gesture(server, direction, debug=False):
    url = f"{server.rstrip('/')}/api/gesture"
    try:
        resp = requests.post(url, json={"direction": direction}, timeout=2)
        resp.raise_for_status()
        print(f"[gesture] {direction} -> {resp.json()}")
    except requests.RequestException as exc:
        print(f"[gesture] failed to POST {direction} to {url}: {exc}", file=sys.stderr)
    if debug:
        print(f"[debug] posted direction={direction}")


def classify_swipe(dx, dy):
    """Returns 'left'/'right'/'up'/'down', or None if it doesn't look deliberate."""
    adx, ady = abs(dx), abs(dy)
    if adx < SWIPE_MIN_DISPLACEMENT_PX and ady < SWIPE_MIN_DISPLACEMENT_PX:
        return None
    if adx >= ady * AXIS_DOMINANCE_RATIO:
        return "left" if dx < 0 else "right"
    if ady >= adx * AXIS_DOMINANCE_RATIO:
        return "up" if dy < 0 else "down"
    return None  # too diagonal / ambiguous to call confidently


def run(camera_index, server, debug):
    import cv2  # imported here so --simulate works without opencv installed

    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        print(f"Could not open camera index {camera_index}", file=sys.stderr)
        sys.exit(1)

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAPTURE_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAPTURE_HEIGHT)
    cap.set(cv2.CAP_PROP_FPS, CAPTURE_FPS)
    actual_w = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
    actual_h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    actual_fps = cap.get(cv2.CAP_PROP_FPS)
    print(
        f"Camera {camera_index}: requested {CAPTURE_WIDTH}x{CAPTURE_HEIGHT}@{CAPTURE_FPS}fps, "
        f"got {actual_w:.0f}x{actual_h:.0f}@{actual_fps:.0f}fps"
    )
    if actual_w > CAPTURE_WIDTH * 1.5:
        print(
            "  Camera ignored the resolution request — it'll work, but detection may run "
            "hotter on CPU than expected. Consider a resize step if that's a problem.",
            file=sys.stderr,
        )

    bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=200, varThreshold=40, detectShadows=False)

    track = deque()  # list of (timestamp, cx, cy) while a motion blob is being followed
    last_gesture_at = 0.0

    print(f"Watching camera {camera_index}, posting gestures to {server}/api/gesture")

    while True:
        ok, frame = cap.read()
        if not ok:
            print("Camera read failed, retrying...", file=sys.stderr)
            time.sleep(0.5)
            continue

        mask = bg_subtractor.apply(frame)
        mask = cv2.medianBlur(mask, 5)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        biggest = max(contours, key=cv2.contourArea, default=None)
        now = time.time()

        big_enough = biggest is not None and cv2.contourArea(biggest) >= MOTION_AREA_MIN
        moments = cv2.moments(biggest) if big_enough else None

        if moments is not None and moments["m00"] > 0:
            cx = moments["m10"] / moments["m00"]
            cy = moments["m01"] / moments["m00"]

            # The "biggest contour" can belong to a different object frame to
            # frame (someone walks by while a swipe is mid-motion, etc.) — a
            # big jump means we're no longer tracking the same thing, so
            # start over rather than blend two unrelated motions into one
            # fake swipe.
            if track:
                _, last_x, last_y = track[-1]
                if math.hypot(cx - last_x, cy - last_y) > MAX_JUMP_PX:
                    track.clear()

            track.append((now, cx, cy))
            # Drop points older than the swipe window so a long, slow drift
            # of unrelated motion doesn't accumulate into a false swipe.
            while track and now - track[0][0] > SWIPE_MAX_WINDOW_S:
                track.popleft()
        else:
            track.clear()

        if len(track) >= 2 and now - last_gesture_at > GESTURE_COOLDOWN_S:
            t0, x0, y0 = track[0]
            t1, x1, y1 = track[-1]
            dx, dy = x1 - x0, y1 - y0
            direction = classify_swipe(dx, dy)
            if debug:
                print(f"[debug] dx={dx:.0f} dy={dy:.0f} dt={t1 - t0:.2f}s -> {direction}")
            if direction:
                post_gesture(server, direction, debug=debug)
                last_gesture_at = now
                track.clear()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--server", default="http://localhost:3001", help="Calendar server base URL")
    parser.add_argument("--camera", type=int, default=0, help="OpenCV camera index (default 0)")
    parser.add_argument("--debug", action="store_true", help="Print every candidate gesture, not just accepted ones")
    parser.add_argument(
        "--simulate",
        choices=["left", "right", "up", "down"],
        help="Skip the camera entirely and just POST this direction once, to test the server integration",
    )
    args = parser.parse_args()

    if args.simulate:
        post_gesture(args.server, args.simulate, debug=args.debug)
        return

    run(args.camera, args.server, args.debug)


if __name__ == "__main__":
    main()
