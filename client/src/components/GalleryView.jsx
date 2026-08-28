import { useEffect, useRef, useState } from 'react';

const SLIDE_INTERVAL_MS = 8000;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function GalleryView() {
  const [photos, setPhotos] = useState(null); // null = loading
  const [index, setIndex] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    fetch('/api/photos')
      .then((r) => r.json())
      .then((data) => setPhotos(shuffle(data)))
      .catch(() => setPhotos([]));
  }, []);

  useEffect(() => {
    if (!photos || photos.length < 2) return;
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % photos.length);
    }, SLIDE_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, [photos]);

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

  return (
    <div className="relative h-full overflow-hidden rounded-2xl bg-surface">
      {photos.map((p, i) => (
        <img
          key={p.filename}
          src={p.url}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-1000"
          style={{ opacity: i === index ? 1 : 0 }}
        />
      ))}
      {photos.length > 1 && (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
          {photos.map((p, i) => (
            <span
              key={p.filename}
              className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-white' : 'bg-white/30'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
