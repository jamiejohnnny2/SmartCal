import { useEffect, useRef, useState } from 'react';
import DetailPage from './DetailPage.jsx';
import GalleryView from './GalleryView.jsx';

const SWIPE_THRESHOLD_PX = 60;
const ANIM_MS = 380;

function renderPage(page, detailProps) {
  return page === 'gallery' ? <GalleryView /> : <DetailPage {...detailProps} />;
}

// Hosts the two pages that share the top half of the screen — Detail
// (today/week/agenda) and Gallery — and animates between them on a vertical
// swipe or an externally-pushed page change (voice, camera gesture). The
// incoming page always slides in from the edge matching the swipe direction:
// swipe up → next page enters from the bottom; swipe down → from the top.
export default function PageStage({ page, onPageChange, pageTransition, ...detailProps }) {
  const [displayPage, setDisplayPage] = useState(page);
  const [anim, setAnim] = useState(null); // { dir, from, to, settled } | null
  const touchStart = useRef(null);
  const pendingDir = useRef(null);
  const lastTransitionId = useRef(null);
  const animTimeout = useRef(null);

  function startAnim(from, to, dir) {
    clearTimeout(animTimeout.current);
    setAnim({ dir, from, to, settled: false });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnim((a) => (a ? { ...a, settled: true } : a)));
    });
    animTimeout.current = setTimeout(() => {
      setDisplayPage(to);
      setAnim(null);
    }, ANIM_MS);
  }

  useEffect(() => {
    if (page === displayPage) return;
    let dir = pendingDir.current;
    if (!dir && pageTransition && pageTransition.id !== lastTransitionId.current) {
      dir = pageTransition.dir;
    }
    if (pageTransition) lastTransitionId.current = pageTransition.id;
    pendingDir.current = null;

    if (dir) {
      startAnim(displayPage, page, dir);
    } else {
      setDisplayPage(page);
    }
    // displayPage intentionally excluded: this should only react to new
    // `page`/`pageTransition` values, not to the animation settling itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageTransition]);

  useEffect(() => () => clearTimeout(animTimeout.current), []);

  function handleTouchStart(e) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e) {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dy) < SWIPE_THRESHOLD_PX || Math.abs(dy) < Math.abs(dx)) return;

    pendingDir.current = dy < 0 ? 'up' : 'down';
    onPageChange(displayPage === 'gallery' ? 'detail' : 'gallery');
  }

  return (
    <div className="relative h-full overflow-hidden" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {anim ? (
        <>
          <div
            className="absolute inset-0 transition-transform ease-out"
            style={{
              transitionDuration: `${ANIM_MS}ms`,
              transform: anim.settled ? `translateY(${anim.dir === 'up' ? '-100%' : '100%'})` : 'translateY(0%)',
            }}
          >
            {renderPage(anim.from, detailProps)}
          </div>
          <div
            className="absolute inset-0 transition-transform ease-out"
            style={{
              transitionDuration: `${ANIM_MS}ms`,
              transform: anim.settled ? 'translateY(0%)' : `translateY(${anim.dir === 'up' ? '100%' : '-100%'})`,
            }}
          >
            {renderPage(anim.to, detailProps)}
          </div>
        </>
      ) : (
        renderPage(displayPage, detailProps)
      )}
    </div>
  );
}
