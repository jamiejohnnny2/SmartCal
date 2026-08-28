import { Router } from 'express';
import { google } from 'googleapis';
import { db } from '../store/db.js';
import { clientForAccount } from '../services/googleAuth.js';
import { syncAccount } from '../services/calendarSync.js';

const router = Router();

function findAccount(accountId, res) {
  const account = db.data.accounts.find((a) => a.id === accountId);
  if (!account) res.status(404).json({ error: 'Unknown account' });
  return account;
}

router.get('/', (req, res) => {
  const { start, end } = req.query;
  let events = db.data.events;
  if (start) events = events.filter((e) => e.end >= start);
  if (end) events = events.filter((e) => e.start <= end);

  const accountsById = Object.fromEntries(db.data.accounts.map((a) => [a.id, a]));
  const enriched = events.map((e) => ({
    ...e,
    accountLabel: accountsById[e.accountId]?.label,
    color: accountsById[e.accountId]?.color,
  }));
  res.json(enriched);
});

router.post('/', async (req, res) => {
  const { accountId, calendarId, title, start, end, allDay, description, location } = req.body;
  const account = findAccount(accountId, res);
  if (!account) return;
  if (!calendarId || !title || !start || !end) {
    return res.status(400).json({ error: 'calendarId, title, start, and end are required' });
  }

  try {
    const auth = clientForAccount(account);
    const calendar = google.calendar({ version: 'v3', auth });

    const requestBody = {
      summary: title,
      description,
      location,
      start: allDay ? { date: start } : { dateTime: start },
      end: allDay ? { date: end } : { dateTime: end },
    };

    const { data: created } = await calendar.events.insert({ calendarId, requestBody });
    await syncAccount(account);
    res.status(201).json({ id: `${account.id}:${calendarId}:${created.id}` });
  } catch (err) {
    console.error('Create event failed:', err.message);
    res.status(502).json({ error: 'Failed to create event on Google Calendar' });
  }
});

router.patch('/:id', async (req, res) => {
  const [accountId, calendarId, googleEventId] = req.params.id.split(':');
  const account = findAccount(accountId, res);
  if (!account) return;

  try {
    const auth = clientForAccount(account);
    const calendar = google.calendar({ version: 'v3', auth });

    const { title, start, end, allDay, description, location } = req.body;
    const requestBody = {};
    if (title !== undefined) requestBody.summary = title;
    if (description !== undefined) requestBody.description = description;
    if (location !== undefined) requestBody.location = location;
    if (start !== undefined) requestBody.start = allDay ? { date: start } : { dateTime: start };
    if (end !== undefined) requestBody.end = allDay ? { date: end } : { dateTime: end };

    await calendar.events.patch({ calendarId, eventId: googleEventId, requestBody });
    await syncAccount(account);
    res.status(204).end();
  } catch (err) {
    console.error('Update event failed:', err.message);
    res.status(502).json({ error: 'Failed to update event on Google Calendar' });
  }
});

router.delete('/:id', async (req, res) => {
  const [accountId, calendarId, googleEventId] = req.params.id.split(':');
  const account = findAccount(accountId, res);
  if (!account) return;

  try {
    const auth = clientForAccount(account);
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId, eventId: googleEventId });
    await syncAccount(account);
    res.status(204).end();
  } catch (err) {
    console.error('Delete event failed:', err.message);
    res.status(502).json({ error: 'Failed to delete event on Google Calendar' });
  }
});

export default router;
