import { useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/Header.jsx';
import PageStage from './components/PageStage.jsx';
import MonthGrid from './components/MonthGrid.jsx';
import EventModal from './components/EventModal.jsx';
import AccountsPanel from './components/AccountsPanel.jsx';
import WakeOverlay from './components/WakeOverlay.jsx';
import { api } from './api.js';

const REFRESH_INTERVAL_MS = 60 * 1000;
const CLOCK_INTERVAL_MS = 30 * 1000;
const FOCUS_POLL_INTERVAL_MS = 3 * 1000;
// Safety nets only — `idle` from linux-voice-assistant is the real dismiss
// signal (see the WS handler below). These just guard against it never
// arriving (a dropped connection, LVA restarting mid-conversation, etc).
const VOICE_FALLBACK_TIMEOUT_MS = 15 * 1000;
const VOICE_FINISHED_TIMEOUT_MS = 4 * 1000;

export default function App() {
  const [events, setEvents] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [calendars, setCalendars] = useState([]);

  const [now, setNow] = useState(new Date());
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [focusDate, setFocusDate] = useState(new Date());
  const [detailMode, setDetailMode] = useState('today');
  const [page, setPage] = useState('detail'); // 'detail' | 'gallery'
  const [pageTransition, setPageTransition] = useState(null); // { dir, id } | null

  const [modalState, setModalState] = useState(null); // { slot } | { event } | null
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  // `voiceData` deliberately isn't cleared when the overlay hides — it keeps
  // whatever it last showed so WakeOverlay has something to fade out from,
  // instead of the content vanishing a beat before the fade even starts.
  const [voiceVisible, setVoiceVisible] = useState(false);
  const [voiceData, setVoiceData] = useState({ phase: null, pingId: 0, transcript: '', response: '' });

  // Tracks the newest server-pushed focus change we've already applied, so a
  // stale poll response can't clobber a focus change made by touch just now.
  const lastAppliedFocusAt = useRef(0);
  const hasSyncedFocusOnce = useRef(false);
  const pageRef = useRef(page);
  const voiceDismissTimer = useRef(null);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

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

  const dismissVoiceOverlay = useCallback(() => {
    clearTimeout(voiceDismissTimer.current);
    setVoiceVisible(false);
  }, []);

  // Merges a partial update into the voice overlay state and (re)arms the
  // fallback dismiss timer — every real event resets this, so it only ever
  // fires if linux-voice-assistant goes quiet mid-conversation (idle should
  // arrive first and dismiss immediately, via the 'voice-idle' case below).
  const applyVoiceUpdate = useCallback((patch, timeoutMs = VOICE_FALLBACK_TIMEOUT_MS) => {
    clearTimeout(voiceDismissTimer.current);
    setVoiceVisible(true);
    setVoiceData((v) => ({ ...v, ...patch }));
    voiceDismissTimer.current = setTimeout(() => setVoiceVisible(false), timeoutMs);
  }, []);

  // Picks up voice-driven and camera-gesture-driven page/view changes pushed
  // via POST /api/focus and /api/gesture (e.g. a Home Assistant automation,
  // or the camera swipe detector). Applies the exact same state a touch
  // interaction would, so this is just another input.
  const pollFocus = useCallback(async () => {
    const focus = await api.getFocus();
    if (focus.updatedAt <= lastAppliedFocusAt.current) return;
    lastAppliedFocusAt.current = focus.updatedAt;
    // The very first poll after mount is just catching up to whatever the
    // server already had — not a fresh command — so it shouldn't dismiss an
    // overlay that couldn't possibly be showing yet for it.
    const isInitialSync = !hasSyncedFocusOnce.current;
    hasSyncedFocusOnce.current = true;

    if (focus.page !== pageRef.current) {
      setPageTransition({ dir: focus.transitionDir || 'up', id: focus.updatedAt });
    }
    setPage(focus.page);
    setDetailMode(focus.detailMode);
    // The display just updated in response to a command — the wake
    // overlay's job (showing something is happening) is done.
    if (!isInitialSync) dismissVoiceOverlay();

    if (focus.date) {
      const d = new Date(focus.date);
      setFocusDate(d);
      setMonthCursor((prev) =>
        prev.getFullYear() === d.getFullYear() && prev.getMonth() === d.getMonth() ? prev : d,
      );
    }
  }, [dismissVoiceOverlay]);

  useEffect(() => {
    refreshEvents();
    refreshAccounts();
    refreshHealth();
    const dataId = setInterval(() => {
      refreshEvents();
      refreshHealth();
    }, REFRESH_INTERVAL_MS);
    const clockId = setInterval(() => setNow(new Date()), CLOCK_INTERVAL_MS);
    const focusId = setInterval(pollFocus, FOCUS_POLL_INTERVAL_MS);
    return () => {
      clearInterval(dataId);
      clearInterval(clockId);
      clearInterval(focusId);
    };
  }, [refreshEvents, refreshAccounts, refreshHealth, pollFocus]);

  // Low-latency push channel from the server — voiceBridge.js relays
  // linux-voice-assistant's whole conversation lifecycle here (wake,
  // listening, transcript, thinking, response text, speaking, idle).
  // Polling would add a multi-second lag that'd defeat the point of an
  // "instant" wake overlay.
  useEffect(() => {
    let closed = false;
    let ws;

    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/ws`);

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case 'voice-wake':
            applyVoiceUpdate({ phase: 'wake', pingId: Date.now(), transcript: '', response: '' });
            break;
          case 'voice-listening':
            applyVoiceUpdate({ phase: 'listening' });
            break;
          case 'voice-transcript':
            applyVoiceUpdate({ transcript: msg.text });
            break;
          case 'voice-thinking':
            applyVoiceUpdate({ phase: 'thinking' });
            break;
          case 'voice-response':
            applyVoiceUpdate({ response: msg.text });
            break;
          case 'voice-speaking':
            applyVoiceUpdate({ phase: 'speaking' });
            break;
          case 'voice-finished':
            // Hold on the final response a few seconds in case `idle` is
            // slow to arrive, rather than cutting the reply off instantly.
            applyVoiceUpdate({}, VOICE_FINISHED_TIMEOUT_MS);
            break;
          case 'voice-idle':
            dismissVoiceOverlay();
            break;
          default:
            break;
        }
      };
      ws.onclose = () => {
        if (!closed) setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(voiceDismissTimer.current);
      ws?.close();
    };
  }, [applyVoiceUpdate, dismissVoiceOverlay]);

  function goToToday() {
    const today = new Date();
    setMonthCursor(today);
    setFocusDate(today);
    setPage('detail');
  }

  function handleSelectDay(day) {
    setFocusDate(day);
    setDetailMode('today');
    setPage('detail');
  }

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
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-bg">
      <Header
        now={now}
        accountCount={accounts.length}
        onOpenAccounts={() => setAccountsOpen(true)}
        onAddEvent={() =>
          setModalState({ slot: { start: focusDate, end: new Date(focusDate.getTime() + 3600000) } })
        }
      />

      <section className="min-h-0 flex-1 px-6 pt-1 pb-4">
        <PageStage
          page={page}
          onPageChange={setPage}
          pageTransition={pageTransition}
          detailMode={detailMode}
          onDetailModeChange={setDetailMode}
          date={focusDate}
          events={events}
          onSelectDay={handleSelectDay}
          onSelectEvent={(event) => setModalState({ event })}
        />
      </section>

      <section className="min-h-0 flex-1 border-t border-line/60 px-6 pt-4 pb-5">
        <MonthGrid
          monthCursor={monthCursor}
          onMonthCursorChange={setMonthCursor}
          onToday={goToToday}
          events={events}
          selectedDate={focusDate}
          onSelectDay={handleSelectDay}
        />
      </section>

      {lastSyncAt && (
        <div className="pointer-events-none absolute bottom-1 right-2 text-[10px] text-faint/70">
          Synced {new Date(lastSyncAt).toLocaleTimeString()}
        </div>
      )}

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
        <AccountsPanel accounts={accounts} onClose={() => setAccountsOpen(false)} onChanged={refreshAccounts} />
      )}

      <WakeOverlay
        visible={voiceVisible}
        phase={voiceData.phase}
        pingId={voiceData.pingId}
        transcript={voiceData.transcript}
        response={voiceData.response}
        onDismiss={dismissVoiceOverlay}
      />
    </div>
  );
}
