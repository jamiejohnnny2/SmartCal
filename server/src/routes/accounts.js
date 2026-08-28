import { Router } from 'express';
import { google } from 'googleapis';
import { nanoid } from 'nanoid';
import { db } from '../store/db.js';
import { exchangeCode, getAuthUrl } from '../services/googleAuth.js';
import { syncAccount } from '../services/calendarSync.js';

const router = Router();

// Distinct colors assigned to accounts in link order, cycling if more accounts are added.
const ACCOUNT_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];

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

export default router;
