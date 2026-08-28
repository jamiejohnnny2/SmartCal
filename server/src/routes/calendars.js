import { Router } from 'express';
import { google } from 'googleapis';
import { db } from '../store/db.js';
import { clientForAccount } from '../services/googleAuth.js';

const router = Router();

// Flat list of { accountId, accountLabel, color, calendarId, calendarSummary }
// across all linked accounts, used to populate the "add event" calendar picker.
router.get('/', async (req, res) => {
  const results = [];
  for (const account of db.data.accounts) {
    try {
      const auth = clientForAccount(account);
      const calendar = google.calendar({ version: 'v3', auth });
      const { data } = await calendar.calendarList.list();
      for (const cal of data.items ?? []) {
        if (cal.selected === false) continue;
        results.push({
          accountId: account.id,
          accountLabel: account.label,
          color: account.color,
          calendarId: cal.id,
          calendarSummary: cal.summary,
          primary: Boolean(cal.primary),
        });
      }
    } catch (err) {
      console.error(`Failed to list calendars for ${account.label}:`, err.message);
    }
  }
  res.json(results);
});

export default router;
