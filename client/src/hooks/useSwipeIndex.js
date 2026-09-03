import { useRef } from 'react';

const SWIPE_THRESHOLD_PX = 40;

// Wraps an index into [0, count): count -> 0, -1 -> count - 1, etc. The
// entire "what page are we on" model is this one function plus a single
// index — there is no separate shadow copy of "current" anywhere else to
// ever disagree with it.
export function wrapIndex(index, count) {
  return ((index % count) + count) % count;
}

// Deliberately not a live-tracking drag: no per-frame transform math, no
// mid-gesture state that can get stuck or stale. A pointer's start position
// is recorded on down; on release, the total travel decides whether it was
// a swipe and which way (+1 or -1) — a single one-shot decision, not
// something built up incrementally that can fall out of sync. The visual
// animation itself is plain CSS (transition-transform on the strip), so
// there's nothing here that can leave a layer stuck mid-position.
export function useSwipeIndex({ axis, onSwipe }) {
  const start = useRef(null);

  function onPointerDown(e) {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerUp(e) {
    const s = start.current;
    start.current = null;
    if (!s || e.pointerId !== s.id) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released — nothing to do
    }

    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const primary = axis === 'y' ? dy : dx;
    const cross = axis === 'y' ? dx : dy;
    if (Math.abs(primary) < SWIPE_THRESHOLD_PX || Math.abs(primary) < Math.abs(cross)) return;
    // The two axes intentionally use opposite-looking signs here: swiping
    // down (dy > 0) is +1 on the vertical axis (gallery=0 -> detail=1), but
    // swiping *left* (dx < 0) is +1 on the horizontal axis (today=0 ->
    // week=1 -> agenda=2) — that's the standard "swipe left to advance"
    // convention (paging through tabs/photos), not an inconsistency.
    const forward = axis === 'y' ? primary > 0 : primary < 0;
    onSwipe(forward ? 1 : -1);
  }

  function onPointerCancel() {
    start.current = null;
  }

  return { onPointerDown, onPointerUp, onPointerCancel };
}
