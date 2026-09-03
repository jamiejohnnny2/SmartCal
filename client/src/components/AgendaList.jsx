import { addDays, eachDayOfInterval } from 'date-fns';
import { format, groupEventsByDay, isSameDay } from '../dateUtils.js';
import { useBoundedScroll } from '../hooks/useBoundedScroll.js';

const AGENDA_SPAN_DAYS = 14;

// Tap-to-open-event is deliberately not restored yet — see useBoundedScroll
// for the scroll piece that was step one of bringing this page's
// interactivity back after isolating it to find the drag-out-of-Agenda bug.
export default function AgendaList({ date, events }) {
  const days = eachDayOfInterval({ start: date, end: addDays(date, AGENDA_SPAN_DAYS) });
  const groups = groupEventsByDay(events, days).filter((g) => g.events.length > 0);
  const today = new Date();

  const { viewportRef, contentRef, offset, handlers } = useBoundedScroll(date.toISOString());

  return (
    <div ref={viewportRef} className="touch-none h-full overflow-hidden pr-1" {...handlers}>
      <div ref={contentRef} style={{ transform: `translateY(${-offset}px)` }}>
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
                  <li
                    key={e.id}
                    className="flex w-full items-center gap-3 rounded-lg bg-surface px-3 py-2 text-left"
                    style={{ borderLeft: `4px solid ${e.color || 'var(--color-accent)'}` }}
                  >
                    <span className="w-16 shrink-0 text-xs text-muted">
                      {e.allDay ? 'All day' : format(e.start, 'h:mm a')}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.title}</span>
                    <span className="shrink-0 text-xs text-faint">{e.accountLabel}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
