import { google } from 'googleapis';
import { db } from '../store/db.js';
import { clientForAccount } from './googleAuth.js';

const SYNC_WINDOW_DAYS_PAST = 7;
const SYNC_WINDOW_DAYS_FUTURE = 60;

function normalizeEvent(ev, account, cal) {
  return {
    id: `${account.id}:${cal.id}:${ev.id}`,
    accountId: account.id,
    calendarId: cal.id,
    calendarSummary: cal.summary,
    googleEventId: ev.id,
    title: ev.summary || '(No title)',
    description: ev.description || '',
    location: ev.location || '',
    start: ev.start?.dateTime || ev.start?.date,
    end: ev.end?.dateTime || ev.end?.date,
    allDay: Boolean(ev.start?.date),
    htmlLink: ev.htmlLink,
  };
}

export async function syncAccount(account) {
  const auth = clientForAccount(account);
  const calendar = google.calendar({ version: 'v3', auth });

  const { data: calListData } = await calendar.calendarList.list();
  const calendars = calListData.items ?? [];

  const timeMin = new Date(Date.now() - SYNC_WINDOW_DAYS_PAST * 86400000).toISOString();
  const timeMax = new Date(Date.now() + SYNC_WINDOW_DAYS_FUTURE * 86400000).toISOString();

  const normalized = [];

  for (const cal of calendars) {
    if (cal.selected === false) continue;
    const { data: eventsData } = await calendar.events.list({
      calendarId: cal.id,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    for (const ev of eventsData.items ?? []) {
      if (ev.status === 'cancelled') continue;
      normalized.push(normalizeEvent(ev, account, cal));
    }
  }

  db.data.events = db.data.events.filter((e) => e.accountId !== account.id);
  db.data.events.push(...normalized);
  await db.write();

  return normalized.length;
}

export async function syncAllAccounts() {
  let total = 0;
  for (const account of db.data.accounts) {
    try {
      total += await syncAccount(account);
    } catch (err) {
      console.error(`Sync failed for account ${account.label} (${account.email}):`, err.message);
    }
  }
  db.data.settings.lastSyncAt = new Date().toISOString();
  await db.write();
  return total;
}

export function startSyncLoop(intervalMs) {
  syncAllAccounts();
  return setInterval(syncAllAccounts, intervalMs);
}
