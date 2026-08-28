import { addMonths, isToday } from 'date-fns';
import { eventsOnDay, format, isSameDay, isSameMonth, monthGridDays } from '../dateUtils.js';

const MAX_CHIPS = 3;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function MonthGrid({ monthCursor, onMonthCursorChange, onToday, events, selectedDate, onSelectDay }) {
  const days = monthGridDays(monthCursor);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h2 className="font-serif text-2xl text-ink">{format(monthCursor, 'MMMM yyyy')}</h2>
        <div className="flex items-center gap-2">
          <button
            className="rounded-full bg-surface-2 px-4 py-2 text-sm font-medium text-muted active:bg-line"
            onClick={onToday}
          >
            Today
          </button>
          <button
            aria-label="Previous month"
            className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-lg text-muted active:bg-line"
            onClick={() => onMonthCursorChange(addMonths(monthCursor, -1))}
          >
            ‹
          </button>
          <button
            aria-label="Next month"
            className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-lg text-muted active:bg-line"
            onClick={() => onMonthCursorChange(addMonths(monthCursor, 1))}
          >
            ›
          </button>
        </div>
      </div>

      <div className="mb-1 grid shrink-0 grid-cols-7 text-center text-xs font-medium tracking-wide text-faint uppercase">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 gap-1">
        {days.map((day) => {
          const inMonth = isSameMonth(day, monthCursor);
          const today = isToday(day);
          const selected = selectedDate && isSameDay(day, selectedDate);
          const dayEvents = eventsOnDay(events, day);
          const overflow = dayEvents.length - MAX_CHIPS;

          return (
            <button
              key={day.toISOString()}
              onClick={() => onSelectDay(day)}
              className={`flex flex-col items-stretch rounded-xl border p-1.5 text-left transition-colors ${
                selected ? 'border-accent/70 bg-surface-2' : 'border-line/60 bg-surface active:bg-surface-2'
              } ${inMonth ? '' : 'opacity-35'}`}
            >
              <span
                className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full font-serif text-sm ${
                  today ? 'bg-accent text-accent-ink' : 'text-ink'
                }`}
              >
                {format(day, 'd')}
              </span>
              <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                {dayEvents.slice(0, MAX_CHIPS).map((e) => (
                  <span
                    key={e.id}
                    className="truncate rounded-sm px-1 py-0.5 text-[11px] leading-tight text-accent-ink"
                    style={{ backgroundColor: e.color || 'var(--color-accent)' }}
                  >
                    {e.title}
                  </span>
                ))}
                {overflow > 0 && <span className="px-1 text-[11px] text-faint">+{overflow} more</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
