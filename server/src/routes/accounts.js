import { Router } from 'express';
import { google } from 'googleapis';
import { nanoid } from 'nanoid';
import { db } from '../store/db.js';
import { exchangeCode, getAuthUrl } from '../services/googleAuth.js';
import { syncAccount } from '../services/calendarSync.js';

const router = Router();

// Muted, warm-palette colors assigned to accounts in link order, cycling if more are added.
// Kept in sync with the accent tones used in client/src/index.css.
const ACCOUNT_COLORS = ['#c96f4a', '#8ba888', '#7c9cb5', '#d4a24c', '#a9789a', '#6fa8a0'];

router.get('/', (req, res) => {
  res.json(db.data.accounts.map(({ tokens, ...rest }) => rest));
});

router.get('/auth-url', (req, res) => {
  const label = typeof req.query.label === 'string' ? req.query.label : '';
  const state = Buffer.from(JSON.stringify({ label })).toString('base64url');
  res.json({ url: getAuthUrl(state) });
});

router.get('/oauth2callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }
  try {
    const { client, tokens } = await exchangeCode(code);
    const oauth2 = google.oauth2({ auth: client, version: 'v2' });
    const { data: userinfo } = await oauth2.userinfo.get();
    let label = '';
    try {
      label = JSON.parse(Buffer.from(String(state), 'base64url').toString()).label;
    } catch {
      // ignore malformed state
    }

    let account = db.data.accounts.find((a) => a.email === userinfo.email);
    if (!account) {
      account = {
        id: nanoid(8),
        label: label || userinfo.name || userinfo.email,
        email: userinfo.email,
        color: ACCOUNT_COLORS[db.data.accounts.length % ACCOUNT_COLORS.length],
        tokens,
      };
      db.data.accounts.push(account);
    } else {
      account.tokens = tokens;
    }
    await db.write();

    syncAccount(account).catch((err) => console.error('Initial sync failed:', err.message));

    res.send(`<!doctype html>
<html>
  <body style="font-family:sans-serif;text-align:center;padding:4rem">
    <h1>&#9989; ${userinfo.email} linked</h1>
    <p>You can close this tab and return to the calendar.</p>
  </body>
</html>`);
  } catch (err) {
    console.error('OAuth callback failed:', err);
    res.status(500).send('Failed to link account: ' + err.message);
  }
});

router.delete('/:id', async (req, res) => {
  db.data.accounts = db.data.accounts.filter((a) => a.id !== req.params.id);
  db.data.events = db.data.events.filter((e) => e.accountId !== req.params.id);
  await db.write();
  res.status(204).end();
});

// Lists one account's own calendars (not the flat cross-account list
// /api/calendars uses for the add-event picker) so the Accounts panel can
// show per-calendar visibility toggles — e.g. muting a work calendar's
// events from the kiosk display without unlinking the whole account.
router.get('/:id/calendars', async (req, res) => {
  const account = db.data.accounts.find((a) => a.id === req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  try {
    const auth = clientForAccount(account);
    const calendar = google.calendar({ version: 'v3', auth });
    const { data } = await calendar.calendarList.list();
    const hidden = new Set(account.hiddenCalendarIds || []);
    res.json(
      (data.items ?? [])
        .filter((cal) => cal.selected !== false)
        .map((cal) => ({
          id: cal.id,
          summary: cal.summary,
          primary: Boolean(cal.primary),
          hidden: hidden.has(cal.id),
        })),
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggles whether one calendar's events show up on the kiosk display. This
// is separate from Google's own per-account "shown in Google Calendar"
// selection (still respected too, in calendarSync.js) — it's ours, so it can
// mute a calendar just for this kiosk without touching the user's actual
// Google Calendar settings, and doesn't affect the add-event calendar picker
// (/api/calendars), since you may still want to add something to a calendar
// you don't want cluttering the passive display.
router.put('/:id/calendars/:calendarId', async (req, res) => {
  const account = db.data.accounts.find((a) => a.id === req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const { hidden } = req.body ?? {};
  account.hiddenCalendarIds = account.hiddenCalendarIds || [];
  const idx = account.hiddenCalendarIds.indexOf(req.params.calendarId);
  if (hidden && idx === -1) account.hiddenCalendarIds.push(req.params.calendarId);
  if (!hidden && idx !== -1) account.hiddenCalendarIds.splice(idx, 1);
  await db.write();
  // Awaited (unlike the fire-and-forget sync elsewhere in this file) so the
  // event list is already up to date by the time this response reaches the
  // client — a visibility toggle should feel immediate, not wait for the
  // next periodic sync.
  try {
    await syncAccount(account);
  } catch (err) {
    console.error('Re-sync after calendar visibility change failed:', err.message);
  }
  res.json({ hiddenCalendarIds: account.hiddenCalendarIds });
});

export default router;
