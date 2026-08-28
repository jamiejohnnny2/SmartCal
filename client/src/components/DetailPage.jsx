import { useRef } from 'react';
import TodayView from './TodayView.jsx';
import WeekStrip from './WeekStrip.jsx';
import AgendaList from './AgendaList.jsx';

const MODES = ['today', 'week', 'agenda'];
const SWIPE_THRESHOLD_PX = 60;

export default function DetailPage({ detailMode, onDetailModeChange, date, events, onSelectDay, onSelectEvent }) {
  const touchStart = useRef(null);

  function cycle(dir) {
    const idx = MODES.indexOf(detailMode);
    const step = dir === 'left' ? 1 : -1;
    onDetailModeChange(MODES[(idx + step + MODES.length) % MODES.length]);
  }

  function handleTouchStart(e) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e) {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    // Only a mostly-horizontal swipe cycles tabs; vertical swipes are handled
    // by the parent PageStage to toggle Detail/Gallery.
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;
    cycle(dx < 0 ? 'left' : 'right');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex shrink-0 gap-1 rounded-full bg-surface p-1">
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => onDetailModeChange(m)}
            className={`flex-1 rounded-full py-2.5 text-base font-medium capitalize transition-colors ${
              detailMode === m ? 'bg-accent text-accent-ink' : 'text-muted active:bg-surface-2'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {detailMode === 'today' && <TodayView date={date} events={events} onSelectEvent={onSelectEvent} />}
        {detailMode === 'week' && <WeekStrip date={date} events={events} onSelectDay={onSelectDay} />}
        {detailMode === 'agenda' && <AgendaList date={date} events={events} onSelectEvent={onSelectEvent} />}
      </div>
    </div>
  );
}
