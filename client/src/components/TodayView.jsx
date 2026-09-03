import { eventsOnDay, format } from '../dateUtils.js';
import { useBoundedScroll } from '../hooks/useBoundedScroll.js';

export default function TodayView({ date, events, onSelectEvent }) {
  const dayEvents = eventsOnDay(events, date);
  const { viewportRef, contentRef, offset, handlers } = useBoundedScroll(date.toISOString());

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 shrink-0">
        <div className="font-serif text-7xl leading-none text-ink">{format(date, 'd')}</div>
        <div className="mt-1 text-lg text-muted">{format(date, 'EEEE, MMMM yyyy')}</div>
      </div>

      <div ref={viewportRef} className="touch-none min-h-0 flex-1 overflow-hidden pr-1" {...handlers}>
        <div ref={contentRef} style={{ transform: `translateY(${-offset}px)` }}>
          {dayEvents.length === 0 && (
            <p className="text-muted">Nothing on the calendar{format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? ' today' : ''}.</p>
          )}
          <ul className="space-y-2">
            {dayEvents.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => onSelectEvent(e)}
                  // See the matching comment in useSwipeCards.js — stops this
                  // button from taking focus on press, which can otherwise
                  // trigger a window-focus hiccup that gets an in-progress
                  // swipe cancelled by the browser.
                  onMouseDown={(e) => e.preventDefault()}
                  className="flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-left active:bg-surface-2"
                  style={{ borderLeft: `4px solid ${e.color || 'var(--color-accent)'}` }}
                >
                  <span className="w-20 shrink-0 text-sm text-muted">
                    {e.allDay ? 'All day' : format(e.start, 'h:mm a')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-ink">{e.title}</span>
                    {e.location && <span className="block truncate text-sm text-faint">{e.location}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-faint">{e.accountLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
