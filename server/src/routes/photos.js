import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';

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
      return { filename: f, url: `/gallery-photos/${f}`, uploadedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  res.json(files);
});

router.post('/', upload.array('photos', 20), (req, res) => {
  res.status(201).json({ uploaded: (req.files ?? []).length });
});

router.delete('/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const target = path.join(galleryDir, filename);
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(target);
  res.status(204).end();
});

export default router;
