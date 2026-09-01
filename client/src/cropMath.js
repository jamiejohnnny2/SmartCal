const MIN_FACE_FRACTION = 0.3; // detected faces should span at least this much of the frame's height

// Computes how to crop+position a photo inside an `object-fit: cover` frame
// so a focal point (e.g. the middle of a detected face) actually ends up
// centered — plain `${focalX*100}% ${focalY*100}%` does NOT do this: percentage
// object-position aligns "X% across the image" with "X% across the
// container", which only matches intuitive centering when the image and
// container share the same aspect ratio. Once they differ (almost always,
// once the image is scaled up to cover a mismatched frame), that naive
// mapping under- or over-shoots the pan and can push a subject toward an
// edge instead of centering it.
//
// Returns both an `objectPosition` (for the base cover-fit) and a `scale`
// multiplier: if the detected face(s) would render smaller than
// MIN_FACE_FRACTION of the frame's height at the plain cover scale, `scale`
// zooms in further (applied as a CSS transform centered on the
// already-centered focal point) so the subjects stay prominent. `cover`
// itself can only ever use the *minimum* scale needed to fill the frame —
// there's no way to ask it for more, hence the separate transform.
export function computePhotoCrop(containerW, containerH, imgW, imgH, focalX, focalY, faceBoxHeight) {
  if (!containerW || !containerH || !imgW || !imgH) {
    return { objectPosition: '50% 50%', scale: 1 };
  }

  const baseScale = Math.max(containerW / imgW, containerH / imgH);
  const overflowX = Math.max(0, imgW * baseScale - containerW);
  const overflowY = Math.max(0, imgH * baseScale - containerH);

  const focalPxX = focalX * imgW * baseScale;
  const focalPxY = focalY * imgH * baseScale;

  const clampedStartX = Math.min(Math.max(focalPxX - containerW / 2, 0), overflowX);
  const clampedStartY = Math.min(Math.max(focalPxY - containerH / 2, 0), overflowY);

  const posX = overflowX > 0 ? (clampedStartX / overflowX) * 100 : 50;
  const posY = overflowY > 0 ? (clampedStartY / overflowY) * 100 : 50;

  let scale = 1;
  if (faceBoxHeight) {
    const faceHeightAtBaseScale = faceBoxHeight * imgH * baseScale;
    scale = Math.max(1, (MIN_FACE_FRACTION * containerH) / faceHeightAtBaseScale);
  }

  return { objectPosition: `${posX}% ${posY}%`, scale };
}
