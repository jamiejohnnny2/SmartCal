import { useCallback, useEffect, useState } from 'react';
import CalendarView from './components/CalendarView.jsx';
import EventModal from './components/EventModal.jsx';
import AccountsPanel from './components/AccountsPanel.jsx';
import { api } from './api.js';

const REFRESH_INTERVAL_MS = 60 * 1000;

export default function App() {
  const [events, setEvents] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [calendars, setCalendars] = useState([]);

  const [view, setView] = useState('week');
  const [date, setDate] = useState(new Date());

  const [modalState, setModalState] = useState(null); // { slot } | { event } | null
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(null);

  const refreshEvents = useCallback(async () => {
    const data = await api.getEvents();
    setEvents(
      data.map((e) => ({
        ...e,
        start: new Date(e.start),
        end: new Date(e.end),
      })),
    );
  }, []);

  const refreshAccounts = useCallback(async () => {
    const [accs, cals] = await Promise.all([api.getAccounts(), api.getCalendars()]);
    setAccounts(accs);
    setCalendars(cals);
  }, []);

  const refreshHealth = useCallback(async () => {
    const res = await fetch('/api/health').then((r) => r.json());
    setLastSyncAt(res.lastSyncAt);
  }, []);

  useEffect(() => {
    refreshEvents();
    refreshAccounts();
    refreshHealth();
    const id = setInterval(() => {
      refreshEvents();
      refreshHealth();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshEvents, refreshAccounts, refreshHealth]);

  async function handleSaveEvent(payload) {
    if (modalState?.event) {
      await api.updateEvent(modalState.event.id, payload);
    } else {
      await api.createEvent(payload);
    }
    setModalState(null);
    await refreshEvents();
  }

  async function handleDeleteEvent() {
    if (!modalState?.event) return;
    await api.deleteEvent(modalState.event.id);
    setModalState(null);
    await refreshEvents();
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50 p-4">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Smart Calendar</h1>
          {lastSyncAt && (
            <p className="text-xs text-slate-400">Last synced {new Date(lastSyncAt).toLocaleTimeString()}</p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            className="rounded-xl bg-slate-200 px-4 py-3 text-lg font-medium text-slate-700 active:bg-slate-300"
            onClick={() => setAccountsOpen(true)}
          >
            Accounts ({accounts.length})
          </button>
          <button
            className="rounded-xl bg-blue-600 px-5 py-3 text-lg font-medium text-white active:bg-blue-700"
            onClick={() => setModalState({ slot: { start: new Date(), end: new Date(Date.now() + 3600000) } })}
          >
            + Add event
          </button>
        </div>
      </header>

      <CalendarView
        events={events}
        view={view}
        date={date}
        onView={setView}
        onNavigate={setDate}
        onSelectSlot={(slot) => setModalState({ slot })}
        onSelectEvent={(event) => setModalState({ event })}
      />

      {modalState && (
        <EventModal
          calendars={calendars}
          initialSlot={modalState.slot}
          initialEvent={modalState.event}
          onClose={() => setModalState(null)}
          onSave={handleSaveEvent}
          onDelete={handleDeleteEvent}
        />
      )}

      {accountsOpen && (
        <AccountsPanel
          accounts={accounts}
          onClose={() => setAccountsOpen(false)}
          onChanged={refreshAccounts}
        />
      )}
    </div>
  );
}
