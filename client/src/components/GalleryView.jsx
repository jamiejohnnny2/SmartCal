import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { computePhotoCrop } from '../cropMath.js';

const SWIPE_THRESHOLD_PX = 40;

// PageStage swaps GalleryView in and out of its "from" slot on every swipe
// between Detail and Gallery — it doesn't stay mounted the way DetailPage's
// own Today/Week/Agenda strip does, so every swipe in was a full remount
// from scratch: photos null again, container size null again. That last
// one is what actually produced the "flash of a different photo" — while
// containerSize is null, every photo below falls back to a generic
// centered crop instead of its real face-aware one, and a tightly-cropped
// photo's centered crop can look like an entirely different picture for
// that one frame, before the ResizeObserver reports back and the correct
// crop replaces it. Module-level, not component state, so it survives the
// remount: seed component state from these instead of null/loading, and a
// swipe in reuses the last known-good render immediately.
let cachedPhotos = null;
let cachedContainerSize = null;

// A stable (non-shuffled) order so the same index always means the same
// photo across re-renders/remounts on a given day — the daily pick below
// depends on that.
function sortStable(photos) {
  return [...photos].sort((a, b) => a.filename.localeCompare(b.filename));
}

// True when two (already stably-sorted) photo lists are the same set in the
// same order — used to skip a state update entirely when a background
// refresh comes back with nothing new. Without this, every refresh forced
// a re-render (and a fresh dailyIndex computation) even when nothing
// changed, which is harmless at rest but visibly disturbed an in-flight
// swipe transition if the fetch happened to resolve mid-drag.
function samePhotoSet(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((p, i) => p.filename === b[i].filename);
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
  // Seeded from the module-level cache below, not from null/loading — see
  // its comment for why that's the actual fix for the flash-on-swipe-in.
  const [photos, setPhotos] = useState(cachedPhotos);
  const [index, setIndex] = useState(() =>
    cachedPhotos ? dailyIndex(cachedPhotos.length, format(new Date(), 'yyyy-MM-dd')) : 0,
  );
  // The "home" photo (today's pick) is pinned and kept rendered/decoded no
  // matter how far you tab away from it — separate from `index` (where you
  // currently are), which is the only one that moves as you tab through.
  const [homeIndex, setHomeIndex] = useState(() =>
    cachedPhotos ? dailyIndex(cachedPhotos.length, format(new Date(), 'yyyy-MM-dd')) : 0,
  );
  const [containerSize, setContainerSize] = useState(cachedContainerSize);
  const containerRef = useRef(null);
  const touchStart = useRef(null);

  // Still fetches on every mount (swiping in), so newly-uploaded photos
  // eventually show up — but skips the state update entirely when nothing
  // actually changed (the common case), instead of forcing a re-render
  // (and a fresh dailyIndex computation) that could otherwise land in the
  // middle of an in-flight swipe transition and visibly disturb it.
  useEffect(() => {
    fetch('/api/photos')
      .then((r) => r.json())
      .then((data) => {
        const sorted = sortStable(data);
        if (samePhotoSet(sorted, cachedPhotos)) return;
        cachedPhotos = sorted;
        const daily = dailyIndex(sorted.length, format(new Date(), 'yyyy-MM-dd'));
        setPhotos(sorted);
        setIndex(daily);
        setHomeIndex(daily);
      })
      .catch(() => setPhotos((prev) => prev ?? []));
  }, []);

  // The correct crop offset depends on the container's actual rendered
  // size relative to each photo's dimensions — see cropMath.js. Starting
  // from the cached size (above) means the very first paint after a
  // remount already uses the real crop instead of the generic centered
  // fallback below; this still re-observes and corrects it (updating the
  // cache too) in case the viewport genuinely changed size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const size = { w: width, h: height };
      cachedContainerSize = size;
      setContainerSize(size);
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

  // The whole point of this app is to feel hand-built for one screen, not
  // like a generic app — a photo that visibly loads in is the opposite of
  // that. Rather than mount every photo in the library at once (correct,
  // but the wrong tradeoff: a big library means a lot of full-size images
  // sitting in memory on a Pi for no benefit) or only the current one
  // (cheap, but the next tap always pays a decode), this keeps a small,
  // explicit window rendered and decoded ahead of time: today's photo
  // (pinned — it's the one you land on the most, swiping in from Detail),
  // whichever one is showing now, and its immediate neighbors in each
  // direction. As `index` moves, this set is recomputed fresh every
  // render, so React mounts whatever just entered it and unmounts whatever
  // fell out — except home, which is always a member and never evicted.
  const len = photos.length;
  const visible = new Set([
    homeIndex,
    index,
    (index + 1) % len,
    (index - 1 + len) % len,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden rounded-2xl bg-surface"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {photos.map((p, i) => {
        if (!visible.has(i)) return null;
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
