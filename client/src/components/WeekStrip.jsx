import { isToday } from 'date-fns';
import { eventsOnDay, format, isSameDay, weekDays } from '../dateUtils.js';

const MAX_CHIPS = 4;

export default function WeekStrip({ date, events, onSelectDay }) {
  const days = weekDays(date);

  return (
    <div className="grid h-full grid-cols-7 gap-2">
      {days.map((day) => {
        const dayEvents = eventsOnDay(events, day);
        const overflow = dayEvents.length - MAX_CHIPS;
        const today = isToday(day);
        const selected = isSameDay(day, date);

        return (
          <button
            key={day.toISOString()}
            onClick={() => onSelectDay(day)}
            className={`flex min-h-0 flex-col rounded-xl border p-2 text-left ${
              selected ? 'border-accent/70 bg-surface-2' : 'border-line/60 bg-surface active:bg-surface-2'
            }`}
          >
            <div className="mb-1 shrink-0 text-center">
              <div className="text-[11px] uppercase tracking-wide text-faint">{format(day, 'EEE')}</div>
              <div
                className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full font-serif text-base ${
                  today ? 'bg-accent text-accent-ink' : 'text-ink'
                }`}
              >
                {format(day, 'd')}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
              {dayEvents.slice(0, MAX_CHIPS).map((e) => (
                <span
                  key={e.id}
                  className="truncate rounded-md px-1.5 py-1 text-[11px] leading-tight text-accent-ink"
                  style={{ backgroundColor: e.color || 'var(--color-accent)' }}
                  title={e.title}
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
  );
}
