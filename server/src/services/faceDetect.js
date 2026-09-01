import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import blazeface from '@tensorflow-models/blazeface';

const CENTER = { focalX: 0.5, focalY: 0.5, imgWidth: null, imgHeight: null };

let backendReady = null;
let modelPromise = null;

function ensureBackend() {
  if (!backendReady) {
    backendReady = (async () => {
      // Resolved via the package's own package.json rather than a hand-built
      // relative path, so this doesn't care whether npm workspaces hoisted
      // the package to the repo root or left it nested under server/.
      const pkgUrl = import.meta.resolve('@tensorflow/tfjs-backend-wasm/package.json');
      const wasmDir = path.join(path.dirname(fileURLToPath(pkgUrl)), 'dist') + path.sep;
      setWasmPaths(wasmDir.replace(/\\/g, '/'));
      await tf.setBackend('wasm');
      await tf.ready();
    })();
  }
  return backendReady;
}

function getModel() {
  if (!modelPromise) modelPromise = blazeface.load();
  return modelPromise;
}

// jpeg-js and pngjs are pure JS (no native compile step, unlike sharp/canvas)
// — deliberately chosen so this doesn't add ARM build headaches on the Pi.
// webp/gif aren't decoded here, so those just fall back to a center crop.
function decodeToRgba(buffer, ext) {
  if (ext === '.jpg' || ext === '.jpeg') {
    const raw = jpeg.decode(buffer, { useTArray: true });
    return { data: raw.data, width: raw.width, height: raw.height };
  }
  if (ext === '.png') {
    const png = PNG.sync.read(buffer);
    return { data: png.data, width: png.width, height: png.height };
  }
  return null;
}

// Returns the fractional (0-1) point to center the crop on for a gallery
// photo — the middle of the union of all detected faces, so a group photo
// keeps everyone in frame instead of cropping around whoever's dead center.
// Falls back to a plain center crop if no faces are found, the format isn't
// decodable (webp/gif), or detection fails for any reason (e.g. no internet
// on first run to fetch the model weights) — a photo should never fail to
// upload just because face detection didn't work.
export async function detectFocalPoint(filePath) {
  let decoded;
  try {
    const ext = path.extname(filePath).toLowerCase();
    decoded = decodeToRgba(fs.readFileSync(filePath), ext);
    if (!decoded) return CENTER;

    await ensureBackend();
    const model = await getModel();

    const rgb = tf.tidy(() =>
      tf.tensor3d(decoded.data, [decoded.height, decoded.width, 4]).slice([0, 0, 0], [-1, -1, 3]),
    );
    let predictions;
    try {
      predictions = await model.estimateFaces(rgb, false);
    } finally {
      rgb.dispose();
    }

    const dims = { imgWidth: decoded.width, imgHeight: decoded.height };
    if (!predictions.length) return { focalX: 0.5, focalY: 0.5, ...dims };

    const minX = Math.min(...predictions.map((p) => p.topLeft[0]));
    const minY = Math.min(...predictions.map((p) => p.topLeft[1]));
    const maxX = Math.max(...predictions.map((p) => p.bottomRight[0]));
    const maxY = Math.max(...predictions.map((p) => p.bottomRight[1]));

    return {
      focalX: (minX + maxX) / 2 / decoded.width,
      focalY: (minY + maxY) / 2 / decoded.height,
      // Fraction of the image spanned by the union of all detected faces —
      // used client-side to zoom in further if the faces would otherwise
      // render too small (see cropMath.js).
      faceBoxWidth: (maxX - minX) / decoded.width,
      faceBoxHeight: (maxY - minY) / decoded.height,
      ...dims,
    };
  } catch (err) {
    console.error(`Face detection failed for ${filePath}:`, err.message);
    // Still report dimensions if we got far enough to decode the image —
    // the client can center the crop even without a detected face.
    if (decoded) return { focalX: 0.5, focalY: 0.5, imgWidth: decoded.width, imgHeight: decoded.height };
    return CENTER;
  }
}
