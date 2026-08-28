import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import accountsRouter from './routes/accounts.js';
import calendarsRouter from './routes/calendars.js';
import eventsRouter from './routes/events.js';
import { startSyncLoop, syncAllAccounts } from './services/calendarSync.js';
import { db } from './store/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, lastSyncAt: db.data.settings.lastSyncAt });
});

app.use('/api/accounts', accountsRouter);
app.use('/api/calendars', calendarsRouter);
app.use('/api/events', eventsRouter);

app.post('/api/sync', async (req, res) => {
  const count = await syncAllAccounts();
  res.json({ synced: count, lastSyncAt: db.data.settings.lastSyncAt });
});

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

app.listen(PORT, () => {
  console.log(`Smart Calendar server listening on http://localhost:${PORT}`);
  const intervalMs = Number(process.env.SYNC_INTERVAL_MS || 3 * 60 * 1000);
  startSyncLoop(intervalMs);
});
