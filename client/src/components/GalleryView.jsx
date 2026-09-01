import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { computePhotoCrop } from '../cropMath.js';

const SWIPE_THRESHOLD_PX = 40;

// A stable (non-shuffled) order so the same index always means the same
// photo across re-renders/remounts on a given day — the daily pick below
// depends on that.
function sortStable(photos) {
  return [...photos].sort((a, b) => a.filename.localeCompare(b.filename));
}

// Deterministic pseudo-random index seeded by the calendar day, so the
// gallery shows one fixed "photo of the day" that changes daily without
// needing to persist which photo was last shown.
function dailyIndex(count, dateKey) {
  if (count === 0) return 0;
  let hash = 0;
  for (let i = 0; i < dateKey.length; i++) hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
  return hash % count;
}

export default function GalleryView() {
  const [photos, setPhotos] = useState(null); // null = loading
  const [index, setIndex] = useState(0);
  const [containerSize, setContainerSize] = useState(null); // { w, h } | null
  const containerRef = useRef(null);
  const touchStart = useRef(null);

  useEffect(() => {
    fetch('/api/photos')
      .then((r) => r.json())
      .then((data) => {
        const sorted = sortStable(data);
        setPhotos(sorted);
        setIndex(dailyIndex(sorted.length, format(new Date(), 'yyyy-MM-dd')));
      })
      .catch(() => setPhotos([]));
  }, []);

  // The correct crop offset depends on the container's actual rendered
  // size relative to each photo's dimensions — see cropMath.js.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [photos]);

  function step(direction) {
    if (!photos || photos.length < 2) return;
    setIndex((i) => (i + direction + photos.length) % photos.length);
  }

  function handleTouchStart(e) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e) {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    const startX = touchStart.current.x;
    touchStart.current = null;

    // A vertical-dominant swipe is the Detail/Gallery page toggle handled
    // by the parent PageStage — ignore it here.
    if (Math.abs(dy) > Math.abs(dx)) return;

    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX) {
      step(dx < 0 ? 1 : -1);
      return;
    }
    // Not a swipe — treat as a tap, advancing in the direction of the side tapped.
    const width = containerRef.current?.getBoundingClientRect().width || 1;
    step(startX < width / 2 ? -1 : 1);
  }

  const uploadUrl =
    typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3001/upload` : '';

  if (photos === null) {
    return <div className="grid h-full place-items-center text-muted">Loading photos…</div>;
  }

  if (photos.length === 0) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <p className="mb-2 font-serif text-2xl text-ink">No photos yet</p>
          <p className="text-muted">
            Add some from your phone at
            <br />
            <span className="text-accent">{uploadUrl}</span>
          </p>
        </div>
      </div>
    );
  }

  const current = photos[index];
  const dateLabel = current.takenAt ? format(new Date(current.takenAt), 'MMMM d, yyyy') : null;

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden rounded-2xl bg-surface"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {photos.map((p, i) => {
        const { objectPosition, scale } = containerSize
          ? computePhotoCrop(containerSize.w, containerSize.h, p.imgWidth, p.imgHeight, p.focalX, p.focalY, p.faceBoxHeight)
          : { objectPosition: '50% 50%', scale: 1 };
        return (
          <img
            key={p.filename}
            src={p.url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
            style={{ opacity: i === index ? 1 : 0, objectPosition, transform: `scale(${scale})` }}
          />
        );
      })}
      {dateLabel && (
        <div className="absolute bottom-3 right-3 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
          {dateLabel}
        </div>
      )}
    </div>
  );
}
