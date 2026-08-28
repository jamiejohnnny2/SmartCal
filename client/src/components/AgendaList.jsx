import { addDays, eachDayOfInterval } from 'date-fns';
import { format, groupEventsByDay, isSameDay } from '../dateUtils.js';

const AGENDA_SPAN_DAYS = 14;

export default function AgendaList({ date, events, onSelectEvent }) {
  const days = eachDayOfInterval({ start: date, end: addDays(date, AGENDA_SPAN_DAYS) });
  const groups = groupEventsByDay(events, days).filter((g) => g.events.length > 0);
  const today = new Date();

  return (
    <div className="h-full overflow-y-auto pr-1">
      {groups.length === 0 && <p className="text-muted">Nothing coming up in the next two weeks.</p>}
      <div className="space-y-4">
        {groups.map(({ day, events: dayEvents }) => (
          <div key={day.toISOString()}>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="font-serif text-lg text-ink">
                {isSameDay(day, today) ? 'Today' : format(day, 'EEEE, MMM d')}
              </span>
            </div>
            <ul className="space-y-1.5">
              {dayEvents.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => onSelectEvent(e)}
                    className="flex w-full items-center gap-3 rounded-lg bg-surface px-3 py-2 text-left active:bg-surface-2"
                    style={{ borderLeft: `4px solid ${e.color || 'var(--color-accent)'}` }}
                  >
                    <span className="w-16 shrink-0 text-xs text-muted">
                      {e.allDay ? 'All day' : format(e.start, 'h:mm a')}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.title}</span>
                    <span className="shrink-0 text-xs text-faint">{e.accountLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
