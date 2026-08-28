import { useEffect, useState } from 'react';

function toLocalInputValue(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const inputClass =
  'w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-lg text-ink placeholder:text-faint focus:border-accent focus:outline-none';

export default function EventModal({ calendars, initialSlot, initialEvent, onClose, onSave, onDelete }) {
  const isEdit = Boolean(initialEvent);
  const [title, setTitle] = useState(initialEvent?.title ?? '');
  const [calendarKey, setCalendarKey] = useState(
    initialEvent ? `${initialEvent.accountId}:${initialEvent.calendarId}` : '',
  );
  const [start, setStart] = useState(toLocalInputValue(initialEvent?.start ?? initialSlot?.start ?? new Date()));
  const [end, setEnd] = useState(
    toLocalInputValue(initialEvent?.end ?? initialSlot?.end ?? new Date(Date.now() + 60 * 60 * 1000)),
  );
  const [location, setLocation] = useState(initialEvent?.location ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarKey && calendars.length > 0) {
      const primary = calendars.find((c) => c.primary) ?? calendars[0];
      setCalendarKey(`${primary.accountId}:${primary.calendarId}`);
    }
  }, [calendars, calendarKey]);

  async function handleSave() {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!calendarKey) {
      setError('Link a Google account first.');
      return;
    }
    const [accountId, calendarId] = calendarKey.split(':');
    setSaving(true);
    setError('');
    try {
      await onSave({
        accountId,
        calendarId,
        title: title.trim(),
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        allDay: false,
        location,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <h3 className="mb-4 font-serif text-3xl text-ink">{isEdit ? 'Edit event' : 'Add event'}</h3>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium text-muted">Title</span>
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
            autoFocus
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium text-muted">Calendar</span>
          <select
            className={inputClass}
            value={calendarKey}
            onChange={(e) => setCalendarKey(e.target.value)}
            disabled={isEdit}
          >
            {calendars.length === 0 && <option value="">No linked accounts</option>}
            {calendars.map((c) => (
              <option key={`${c.accountId}:${c.calendarId}`} value={`${c.accountId}:${c.calendarId}`}>
                {c.accountLabel} — {c.calendarSummary}
              </option>
            ))}
          </select>
        </label>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-muted">Start</span>
            <input
              type="datetime-local"
              className={`${inputClass} px-3 text-base`}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-muted">End</span>
            <input
              type="datetime-local"
              className={`${inputClass} px-3 text-base`}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>

        <label className="mb-5 block">
          <span className="mb-1 block text-sm font-medium text-muted">Location (optional)</span>
          <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="flex items-center justify-between gap-3">
          {isEdit ? (
            <button
              className="rounded-xl bg-red-500/10 px-4 py-3 text-lg font-medium text-red-400 active:bg-red-500/20"
              onClick={onDelete}
              disabled={saving}
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-3">
            <button
              className="rounded-xl bg-surface-2 px-5 py-3 text-lg font-medium text-muted active:bg-line"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              className="rounded-xl bg-accent px-5 py-3 text-lg font-medium text-accent-ink active:opacity-80 disabled:opacity-50"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
