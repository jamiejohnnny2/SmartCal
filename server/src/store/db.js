import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSONFilePreset } from 'lowdb/node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', '..', 'data');
const dbPath = path.join(dataDir, 'db.json');

fs.mkdirSync(dataDir, { recursive: true });

const defaultData = {
  accounts: [],
  events: [],
  settings: { lastSyncAt: null },
  // Per-photo gallery metadata, keyed by filename: { focalX, focalY,
  // faceBoxWidth, faceBoxHeight, imgWidth, imgHeight, takenAt }.
  photoMeta: {},
};

export const db = await JSONFilePreset(dbPath, defaultData);

// lowdb writes atomically (temp file + rename); a sync tool touching db.json
// at the wrong moment (OneDrive, in this dev setup) can make that rename
// fail transiently. Without this, that failure is an unhandled rejection
// that crashes the whole server — log and move on instead, since the next
// write will simply try again with then-current data.
const rawWrite = db.write.bind(db);
db.write = async () => {
  try {
    await rawWrite();
  } catch (err) {
    console.error('Failed to persist db.json, will retry on next write:', err.message);
  }
};

// JSONFilePreset only applies defaultData when the file doesn't exist yet —
// backfill any keys added since an existing db.json was first created.
db.data.photoMeta ??= {};
await db.write();
