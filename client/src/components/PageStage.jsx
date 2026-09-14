import { useEffect, useRef } from 'react';
import { useSwipeCards } from '../hooks/useSwipeCards.js';
import DetailPage from './DetailPage.jsx';
import GalleryView from './GalleryView.jsx';

// The "counter" for this axis: just two pages, so "the other one" is the
// whole rule — no separate index needed to express it.
function otherPage(p) {
  return p === 'gallery' ? 'detail' : 'gallery';
}

function renderPage(page, detailProps) {
  return page === 'gallery' ? <GalleryView /> : <DetailPage {...detailProps} />;
}

// Hosts the two pages sharing the top half of the screen — Detail and
// Gallery — and swaps between them on a vertical swipe, via the shared
// useSwipeCards engine (see its comment for the drag/settle mechanics). A
// voice command (pushed via server poll) plays the same slide animation but
// as a programmatic transition, since there's no finger position to track.
export default function PageStage({ page, onPageChange, pageTransition, ...detailProps }) {
  const lastTransitionId = useRef(null);

  const { containerRef, fromRef, toRef, displayValue: displayPage, preview, triggerTransition, handlers } =
    useSwipeCards({
      axis: 'y',
      value: page,
      onChange: onPageChange,
      neighbor: (dir, current) => otherPage(current),
    });

  // External changes (voice via /api/focus) arrive as a `page` prop change
  // plus a fresh `pageTransition` — animate as a full eased transition from
  // 0 to 1.
  useEffect(() => {
    if (!pageTransition || pageTransition.id === lastTransitionId.current) return;
    lastTransitionId.current = pageTransition.id;
    triggerTransition(page, pageTransition.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageTransition]);

  return (
    <div
      ref={containerRef}
      // touch-none (touch-action: none) plus Pointer Capture (see useSwipeCards)
      // together give this element exclusive, guaranteed ownership of the
      // gesture — without them the browser's own native scroll/pan gesture
      // recognizer can compete for the same input on real touch hardware and
      // partially or fully claim it mid-gesture, which is what a swipe that
      // registers a little then stalls looks like.
      className="relative h-full touch-none overflow-hidden"
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    >
      {/* The "from" layer always renders in this same absolute-positioned
          div, whether or not a preview is active, and always shows
          whichever page is logically current (preview.from during a
          transition, or displayPage the rest of the time — always equal at
          the moment a transition starts). Conditionally choosing between a
          bare renderPage(...) and one wrapped in this div changes the JSX
          tree shape every time a drag starts or ends, and React unmounts +
          remounts whatever's inside rather than reusing it — wiping
          DetailPage's entire internal state on every drag attempt, even
          ones that get cancelled and spring back. Keeping this div always
          present keeps DetailPage/GalleryView mounted continuously across
          attempted-but-cancelled swipes; it only actually unmounts when the
          page you're on for real changes. Starting transform is applied
          imperatively by useSwipeCards, not here — a JSX inline style would
          get re-applied on every unrelated re-render and reset a mid-flight
          animation. */}
      <div ref={fromRef} className="absolute inset-0">
        {renderPage(preview ? preview.from : displayPage, detailProps)}
      </div>
      {preview && (
        <div ref={toRef} className="absolute inset-0">
          {renderPage(preview.to, detailProps)}
        </div>
      )}
    </div>
  );
}
