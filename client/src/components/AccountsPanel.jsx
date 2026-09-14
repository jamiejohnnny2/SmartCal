import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api.js';

export default function AccountsPanel({ accounts, onClose, onChanged, onEventsChanged }) {
  const [label, setLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [error, setError] = useState('');

  // Which account's calendar list is expanded, and each account's calendars
  // once fetched — fetched lazily on expand rather than for every account up
  // front, since it's a live Google API call per account.
  const [expandedId, setExpandedId] = useState(null);
  const [calendarsByAccount, setCalendarsByAccount] = useState({});
  const [calendarsLoading, setCalendarsLoading] = useState(null);

  async function handleGenerateLink() {
    setError('');
    try {
      const { url } = await api.getAuthUrl(label.trim());
      setLinkUrl(url);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemove(id) {
    await api.deleteAccount(id);
    onChanged();
  }

  async function handleToggleExpand(accountId) {
    if (expandedId === accountId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(accountId);
    if (calendarsByAccount[accountId]) return;
    setCalendarsLoading(accountId);
    try {
      const cals = await api.getAccountCalendars(accountId);
      setCalendarsByAccount((prev) => ({ ...prev, [accountId]: cals }));
    } catch (err) {
      setError(err.message);
    } finally {
      setCalendarsLoading(null);
    }
  }

  async function handleToggleCalendar(accountId, cal) {
    const nextHidden = !cal.hidden;
    // Optimistic — a toggle should feel instant; reverted below if the
    // request actually fails.
    setCalendarsByAccount((prev) => ({
      ...prev,
      [accountId]: prev[accountId].map((c) => (c.id === cal.id ? { ...c, hidden: nextHidden } : c)),
    }));
    try {
      await api.setCalendarHidden(accountId, cal.id, nextHidden);
      onEventsChanged?.();
    } catch (err) {
      setCalendarsByAccount((prev) => ({
        ...prev,
        [accountId]: prev[accountId].map((c) => (c.id === cal.id ? { ...c, hidden: cal.hidden } : c)),
      }));
      setError(err.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif text-3xl text-ink">Linked accounts</h3>
          <button
            className="rounded-xl bg-surface-2 px-4 py-2 text-base text-muted active:bg-line"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <ul className="mb-6 divide-y divide-line">
          {accounts.length === 0 && <li className="py-3 text-muted">No accounts linked yet.</li>}
          {accounts.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex items-center justify-between">
                <button
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => handleToggleExpand(a.id)}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: a.color }} />
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{a.label}</div>
                    <div className="text-sm text-faint">{a.email}</div>
                  </div>
                  <span className="ml-auto shrink-0 text-xs text-faint">
                    {expandedId === a.id ? 'Hide calendars ▲' : 'Calendars ▼'}
                  </span>
                </button>
                <button
                  className="ml-3 shrink-0 rounded-xl bg-red-500/10 px-3 py-2 text-sm font-medium text-red-400 active:bg-red-500/20"
                  onClick={() => handleRemove(a.id)}
                >
                  Unlink
                </button>
              </div>

              {expandedId === a.id && (
                <div className="mt-3 rounded-xl bg-surface-2 p-3">
                  {calendarsLoading === a.id && <p className="text-sm text-faint">Loading calendars…</p>}
                  {calendarsLoading !== a.id && (calendarsByAccount[a.id]?.length ?? 0) === 0 && (
                    <p className="text-sm text-faint">No calendars found.</p>
                  )}
                  <ul className="space-y-1">
                    {(calendarsByAccount[a.id] || []).map((cal) => (
                      <li key={cal.id} className="flex items-center justify-between gap-3 py-1">
                        <span className="min-w-0 truncate text-sm text-ink">
                          {cal.summary}
                          {cal.primary && <span className="text-faint"> (primary)</span>}
                        </span>
                        <button
                          role="switch"
                          aria-checked={!cal.hidden}
                          onClick={() => handleToggleCalendar(a.id, cal)}
                          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                            cal.hidden ? 'bg-surface' : 'bg-accent'
                          }`}
                        >
                          <span
                            className={`absolute top-1 h-5 w-5 rounded-full bg-ink transition-transform ${
                              cal.hidden ? 'translate-x-1' : 'translate-x-6'
                            }`}
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-faint">
                    Off hides that calendar's events from the kiosk display only — it stays untouched in Google
                    Calendar itself, and still shows up when adding a new event.
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="rounded-xl border border-line p-4">
          <p className="mb-3 text-sm text-muted">
            Link a new Google account. Google's sign-in page works best on a phone or laptop — scan the QR code
            below with that device, or copy the link.
          </p>
          <input
            className="mb-3 w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-lg text-ink placeholder:text-faint focus:border-accent focus:outline-none"
            placeholder="Whose calendar is this? (e.g. Mom)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            className="w-full rounded-xl bg-accent px-4 py-3 text-lg font-medium text-accent-ink active:opacity-80"
            onClick={handleGenerateLink}
          >
            Generate link
          </button>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          {linkUrl && (
            <div className="mt-4 flex flex-col items-center gap-3">
              <div className="rounded-xl bg-white p-3">
                <QRCodeSVG value={linkUrl} size={180} />
              </div>
              <a href={linkUrl} target="_blank" rel="noreferrer" className="break-all text-sm text-accent underline">
                {linkUrl}
              </a>
              <p className="text-xs text-faint">
                After completing sign-in on your phone, come back here and close this dialog — the account will
                appear in the list above within a few seconds.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
