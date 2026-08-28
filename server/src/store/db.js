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
};

export const db = await JSONFilePreset(dbPath, defaultData);
