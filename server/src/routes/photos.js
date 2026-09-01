import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { detectFocalPoint } from '../services/faceDetect.js';
import { extractTakenAt } from '../services/exif.js';
import { db } from '../store/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const galleryDir = path.join(__dirname, '..', '..', 'data', 'gallery');
fs.mkdirSync(galleryDir, { recursive: true });

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, galleryDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${nanoid(6)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.has(ext));
  },
});

const router = Router();

router.get('/', (req, res) => {
  const files = fs
    .readdirSync(galleryDir)
    .filter((f) => ALLOWED_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => {
      const stat = fs.statSync(path.join(galleryDir, f));
      const meta = db.data.photoMeta[f] ?? { focalX: 0.5, focalY: 0.5 };
      return { filename: f, url: `/gallery-photos/${f}`, uploadedAt: stat.mtime.toISOString(), ...meta };
    })
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  res.json(files);
});

// Runs face detection + EXIF date extraction on each upload — see
// services/faceDetect.js and services/exif.js. Photos added by dropping
// files into data/gallery/ directly (Samba, Syncthing, etc. — see README)
// skip this and just get a center crop / no date caption, since there's no
// upload event to hook for those.
router.post('/', upload.array('photos', 20), async (req, res) => {
  const files = req.files ?? [];
  for (const file of files) {
    const filePath = path.join(galleryDir, file.filename);
    const [focal, takenAt] = await Promise.all([detectFocalPoint(filePath), extractTakenAt(filePath)]);
    db.data.photoMeta[file.filename] = { ...focal, takenAt };
  }
  await db.write();
  res.status(201).json({ uploaded: files.length });
});

// One-time cleanup for the photoFocals -> photoMeta rename (added
// faceBoxWidth/faceBoxHeight/takenAt): recomputes full metadata for any
// photo still only present under the old key, then drops it. No-op once
// there's nothing left under the old key.
export async function migrateLegacyPhotoMeta() {
  const legacy = db.data.photoFocals;
  if (!legacy || Object.keys(legacy).length === 0) return;

  for (const filename of Object.keys(legacy)) {
    const filePath = path.join(galleryDir, filename);
    if (!fs.existsSync(filePath) || db.data.photoMeta[filename]) continue;
    const [focal, takenAt] = await Promise.all([detectFocalPoint(filePath), extractTakenAt(filePath)]);
    db.data.photoMeta[filename] = { ...focal, takenAt };
  }
  delete db.data.photoFocals;
  await db.write();
}

router.delete('/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename);
  const target = path.join(galleryDir, filename);
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(target);
  delete db.data.photoMeta[filename];
  await db.write();
  res.status(204).end();
});

export default router;
