import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import accountsRouter from './routes/accounts.js';
import calendarsRouter from './routes/calendars.js';
import eventsRouter from './routes/events.js';
import focusRouter from './routes/focus.js';
import gestureRouter from './routes/gesture.js';
import photosRouter, { galleryDir, migrateLegacyPhotoMeta } from './routes/photos.js';
import voiceRouter from './routes/voice.js';
import { startSyncLoop, syncAllAccounts } from './services/calendarSync.js';
import { startVoiceBridge } from './services/voiceBridge.js';
import { attachWsHub } from './services/wsHub.js';
import { db } from './store/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, lastSyncAt: db.data.settings.lastSyncAt });
});

app.use('/api/accounts', accountsRouter);
app.use('/api/calendars', calendarsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/focus', focusRouter);
app.use('/api/gesture', gestureRouter);
app.use('/api/photos', photosRouter);
app.use('/api/voice', voiceRouter);

app.post('/api/sync', async (req, res) => {
  const count = await syncAllAccounts();
  res.json({ synced: count, lastSyncAt: db.data.settings.lastSyncAt });
});

// Mobile-friendly page (visit from a phone) for syncing photos into the
// Gallery focus view — plain static HTML, not part of the React kiosk app.
app.get('/upload', (req, res) => res.sendFile(path.join(publicDir, 'upload.html')));
app.use('/gallery-photos', express.static(galleryDir));

// One-click test panel for the voice overlay — plays a full simulated
// conversation through the real broadcast path (/api/voice/simulate) so it
// can be watched on the kiosk display without a mic or linux-voice-assistant
// installed. See homeassistant/README.md.
app.get('/voice-test', (req, res) => res.sendFile(path.join(publicDir, 'voice-test.html')));

// Serves the built kiosk UI (client/dist) when present, so on the Pi a single
// process (this server) can be pointed at directly by the kiosk browser.
// In local dev the client instead runs its own Vite dev server on :5173.
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (req, res, next) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

const PORT = process.env.PORT || 3001;

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.warn(
    '[smart-calendar] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — copy server/.env.example to server/.env and fill them in before linking accounts.',
  );
}

const httpServer = app.listen(PORT, () => {
  console.log(`Smart Calendar server listening on http://localhost:${PORT}`);
  const intervalMs = Number(process.env.SYNC_INTERVAL_MS || 3 * 60 * 1000);
  startSyncLoop(intervalMs);
  migrateLegacyPhotoMeta().catch((err) => console.error('Photo metadata migration failed:', err.message));
});

attachWsHub(httpServer, '/ws');
startVoiceBridge();
