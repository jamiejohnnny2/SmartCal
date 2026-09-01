import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import DetailPage from './DetailPage.jsx';
import GalleryView from './GalleryView.jsx';

const DRAG_ACTIVATE_PX = 10; // minimum movement before a touch commits to being a vertical drag
const COMMIT_THRESHOLD = 0.35; // fraction of the panel's height needed to complete the swipe
const MAX_SETTLE_MS = 320; // settle duration for a full-length transition; scaled down by remaining distance

function otherPage(p) {
  return p === 'gallery' ? 'detail' : 'gallery';
}

function renderPage(page, detailProps) {
  return page === 'gallery' ? <GalleryView /> : <DetailPage {...detailProps} />;
}

// which: 'from' (the page being left) or 'to' (the page coming in).
// up:   from slides 0 -> -100 (up and out); to slides 100 -> 0 (in from below)
// down: from slides 0 -> 100 (down and out); to slides -100 -> 0 (in from above)
function layerTransform(dir, progress, which) {
  if (dir === 'up') {
    return which === 'from' ? `translateY(${-progress * 100}%)` : `translateY(${100 - progress * 100}%)`;
  }
  return which === 'from' ? `translateY(${progress * 100}%)` : `translateY(${-100 + progress * 100}%)`;
}

// Hosts the two pages sharing the top half of the screen — Detail and
// Gallery — and swaps between them on a vertical swipe. A touch drag tracks
// the finger live (the incoming page follows your finger 1:1, no waiting for
// release), and lifting either completes the swipe or springs back depending
// on how far you dragged. A voice command or camera gesture (pushed via
// server poll) animates the same way but as a single eased transition,
// since there's no finger position to track.
export default function PageStage({ page, onPageChange, pageTransition, ...detailProps }) {
  const [displayPage, setDisplayPage] = useState(page);
  const [preview, setPreview] = useState(null); // { dir, from, to } | null — mounted while dragging or settling

  const containerRef = useRef(null);
  const fromRef = useRef(null);
  const toRef = useRef(null);
  const drag = useRef(null); // live touch state; see handleTouchStart
  const lastTransitionId = useRef(null);
  const cleanupTimer = useRef(null);
  const settling = useRef(false); // true from settle() start until its cleanup runs

  // Applies each new preview's starting position exactly once, right after
  // its layers mount — keyed on `preview`'s identity, not on every render.
  // This used to be a JSX inline `style={{ transform: layerTransform(...) }}`
  // with a hardcoded progress of 0, which is the kind of thing that looks
  // harmless but isn't: React re-applies inline styles on *every* re-render,
  // so any unrelated state change elsewhere in the app (the clock ticking,
  // a data refresh, anything) while a drag or settle animation was mid-flight
  // would silently snap the transform back to its starting position — a
  // swipe that "freezes" or only half-completes, needing a second attempt.
  useLayoutEffect(() => {
    if (preview) setLayerProgress(preview.dir, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  function setLayerTransition(transition) {
    if (fromRef.current) fromRef.current.style.transition = transition;
    if (toRef.current) toRef.current.style.transition = transition;
  }

  function setLayerProgress(dir, progress) {
    if (fromRef.current) fromRef.current.style.transform = layerTransform(dir, progress, 'from');
    if (toRef.current) toRef.current.style.transform = layerTransform(dir, progress, 'to');
  }

  // Animates from wherever the layers currently sit (startProgress) to a
  // final progress of 1 (commit — finish changing pages) or 0 (cancel —
  // spring back), then settles React state once the transition completes.
  function settle(dir, from, to, startProgress, target) {
    clearTimeout(cleanupTimer.current);
    settling.current = true;
    const duration = Math.max(80, MAX_SETTLE_MS * Math.abs(target - startProgress));
    setLayerTransition(`transform ${duration}ms ease-out`);
    requestAnimationFrame(() => setLayerProgress(dir, target));
    cleanupTimer.current = setTimeout(() => {
      setDisplayPage(target === 1 ? to : from);
      setPreview(null);
      settling.current = false;
    }, duration);
  }

  // External changes (voice via /api/focus, camera gesture via /api/gesture)
  // arrive as a `page` prop change plus a fresh `pageTransition` — animate
  // as a full eased transition from 0 to 1.
  useEffect(() => {
    if (drag.current || settling.current) return; // a live touch drag or an in-progress local settle takes priority
    if (page === displayPage) return;

    let dir = null;
    if (pageTransition && pageTransition.id !== lastTransitionId.current) {
      dir = pageTransition.dir;
    }
    if (pageTransition) lastTransitionId.current = pageTransition.id;

    if (!dir) {
      setDisplayPage(page);
      return;
    }
    const from = displayPage;
    setLayerTransition('none');
    setPreview({ dir, from, to: page });
    requestAnimationFrame(() => settle(dir, from, page, 0, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageTransition]);

  useEffect(() => () => clearTimeout(cleanupTimer.current), []);

  function handleTouchStart(e) {
    const t = e.touches[0];
    drag.current = {
      startX: t.clientX,
      startY: t.clientY,
      dir: null,
      decided: false,
      progress: 0,
      height: containerRef.current?.getBoundingClientRect().height || 1,
    };
  }

  function handleTouchMove(e) {
    const d = drag.current;
    if (!d) return;
    const t = e.touches[0];
    const dx = t.clientX - d.startX;
    const dy = t.clientY - d.startY;

    if (!d.decided) {
      if (Math.abs(dy) < DRAG_ACTIVATE_PX || Math.abs(dy) < Math.abs(dx)) return;
      d.decided = true;
      d.dir = dy < 0 ? 'up' : 'down';
      // Record this move's own progress now — a fast, decisive swipe often
      // only produces one touchmove before touchend, and without this the
      // commit/cancel decision would always see progress stuck at 0.
      d.progress = Math.min(1, Math.abs(dy) / d.height);
      clearTimeout(cleanupTimer.current);
      setLayerTransition('none');
      setPreview({ dir: d.dir, from: displayPage, to: otherPage(displayPage) });
      // The layers haven't mounted yet this tick — apply the visual once they have.
      requestAnimationFrame(() => setLayerProgress(d.dir, d.progress));
      return;
    }

    d.progress = Math.min(1, Math.abs(dy) / d.height);
    setLayerProgress(d.dir, d.progress);
  }

  function handleTouchEnd() {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.decided) return;

    const from = displayPage;
    const to = otherPage(displayPage);
    if (d.progress >= COMMIT_THRESHOLD) {
      onPageChange(to);
      settle(d.dir, from, to, d.progress, 1);
    } else {
      settle(d.dir, from, to, d.progress, 0);
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {preview ? (
        <>
          {/* Starting transform is applied imperatively by the useLayoutEffect
              above, not here — see its comment for why that matters. */}
          <div ref={fromRef} className="absolute inset-0">
            {renderPage(preview.from, detailProps)}
          </div>
          <div ref={toRef} className="absolute inset-0">
            {renderPage(preview.to, detailProps)}
          </div>
        </>
      ) : (
        renderPage(displayPage, detailProps)
      )}
    </div>
  );
}
