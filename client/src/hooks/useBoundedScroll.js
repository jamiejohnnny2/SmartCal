import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const DRAG_ACTIVATE_PX = 10; // minimum movement before a drag commits to being a scroll

// A vertical content region that clips to its viewport and translates its
// content to "scroll" — not a native overflow:auto scroll, deliberately:
// PageStage's vertical swipe (Detail <-> Gallery) needs guaranteed,
// uncontested ownership of any vertical drag it decides to claim
// (touch-action: none + pointer capture — see useSwipeCards), and that
// can't reliably coexist with a genuinely native-scrolling descendant —
// the browser can still start negotiating a native scroll on its own in
// practice, regardless of touch-action. This gives the same drag-to-scroll
// feel with none of that risk, using the same claim/pass-through pattern
// already proven for paging, just applied to a scroll offset instead.
//
// Priority rule: a vertical drag here scrolls the content normally, for as
// long as there's still room to move it further in that direction. The
// instant you're already at the edge you're dragging toward, this stops
// claiming the gesture at all — no stopPropagation, no preventDefault — so
// it bubbles up exactly like a drag with nothing scrollable under it
// always has, and PageStage's own vertical swipe picks it up from there. A
// horizontal-dominant drag is never claimed here either way, and reaches
// DetailPage's left/right mode-swipe untouched.
export function useBoundedScroll(resetKey) {
  const [offset, setOffset] = useState(0);
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const maxRef = useRef(0);
  const offsetRef = useRef(0);
  const drag = useRef(null);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    setOffset(0);
  }, [resetKey]);

  // Re-measures whenever the viewport or the content's own size changes —
  // covers both this view resizing and its content growing/shrinking (a
  // different day's events, a different agenda range).
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    function measure() {
      const max = Math.max(0, content.scrollHeight - viewport.clientHeight);
      maxRef.current = max;
      setOffset((o) => Math.min(o, max));
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewport);
    ro.observe(content);
    return () => ro.disconnect();
  });

  function handlePointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startOffset: offsetRef.current,
      decided: false,
    };
  }

  function handlePointerMove(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dy = e.clientY - d.startY;
    const dx = e.clientX - d.startX;

    if (!d.decided) {
      if (Math.abs(dy) < DRAG_ACTIVATE_PX || Math.abs(dy) < Math.abs(dx)) return;
      d.decided = true;
    }

    // Dragging up (dy < 0) reveals content further down (offset grows);
    // dragging down (dy > 0) reveals content further up (offset shrinks).
    const wanted = d.startOffset - dy;
    if (wanted < 0 || wanted > maxRef.current) return; // at the edge — not ours, let it bubble

    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    setOffset(wanted);
  }

  function handlePointerEnd(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
  }

  return {
    viewportRef,
    contentRef,
    offset,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerEnd,
      onPointerCancel: handlePointerEnd,
    },
  };
}
