import { useSwipeCards } from '../hooks/useSwipeCards.js';
import TodayView from './TodayView.jsx';
import WeekStrip from './WeekStrip.jsx';
import AgendaList from './AgendaList.jsx';

const MODES = ['today', 'week', 'agenda'];

// The "counter" that decides what's next: a plain index into MODES with
// wraparound (0=today, 1=week, 2=agenda; past either end wraps to the
// other), computed fresh from whatever the current mode string is — never
// a separately-tracked number that could drift from it.
function neighborMode(dir, current) {
  const idx = MODES.indexOf(current);
  const step = dir === 'left' ? 1 : -1;
  return MODES[(idx + step + MODES.length) % MODES.length];
}

function renderMode(mode, { date, events, onSelectDay, onSelectEvent }) {
  if (mode === 'week') return <WeekStrip date={date} events={events} onSelectDay={onSelectDay} />;
  if (mode === 'agenda') return <AgendaList date={date} events={events} onSelectEvent={onSelectEvent} />;
  return <TodayView date={date} events={events} onSelectEvent={onSelectEvent} />;
}

// Today / Week / Agenda as a horizontal card carousel — a finger drag tracks
// 1:1 and either commits to the neighboring card or springs back on release
// (see useSwipeCards, shared with PageStage's vertical Detail <-> Gallery
// swipe). Tapping a tab plays the identical slide, just without a live drag
// to start from.
export default function DetailPage(props) {
  const { detailMode, onDetailModeChange, ...viewProps } = props;

  const {
    containerRef,
    fromRef,
    toRef,
    displayValue: displayMode,
    preview,
    getCurrent,
    triggerTransition,
    handlers,
  } = useSwipeCards({
    axis: 'x',
    value: detailMode,
    onChange: onDetailModeChange,
    neighbor: neighborMode,
  });

  function handleTabClick(m) {
    // getCurrent(), not displayMode — displayMode (React state) can still be
    // lagging behind a just-committed swipe or tab-click for up to the
    // settle animation's duration. Comparing against it here while
    // triggerTransition compares against the always-fresh getCurrent()
    // internally is exactly how a tap can silently do nothing: this check
    // says "not there yet" and calls triggerTransition, which then says
    // "actually we already are" and bails — no animation, no visible
    // response at all.
    const current = getCurrent();
    if (m === current) return;
    const dir = MODES.indexOf(m) > MODES.indexOf(current) ? 'left' : 'right';
    onDetailModeChange(m);
    triggerTransition(m, dir);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex shrink-0 gap-1 rounded-full bg-surface p-1">
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => handleTabClick(m)}
            className={`flex-1 rounded-full py-2.5 text-base font-medium capitalize transition-colors ${
              detailMode === m ? 'bg-accent text-accent-ink' : 'text-muted active:bg-surface-2'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div
        ref={containerRef}
        // touch-none: see the matching comment in PageStage.jsx — this plus
        // Pointer Capture (in useSwipeCards) gives this element exclusive,
        // guaranteed ownership of the drag on real touch hardware.
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
      >
        {/* Same structural rule as PageStage.jsx's matching comment: the
            "from" layer always renders in this same div regardless of
            whether a preview is active, so a drag that starts and gets
            cancelled doesn't unmount/remount TodayView/WeekStrip/AgendaList
            (React would otherwise treat the always-vs-wrapped choice as a
            different tree shape and tear down whichever view is showing).
            Starting transform is applied imperatively by useSwipeCards. */}
        <div ref={fromRef} className="absolute inset-0">
          {renderMode(preview ? preview.from : displayMode, viewProps)}
        </div>
        {preview && (
          <div ref={toRef} className="absolute inset-0">
            {renderMode(preview.to, viewProps)}
          </div>
        )}
      </div>
    </div>
  );
}
