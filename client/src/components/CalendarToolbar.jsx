const VIEW_LABELS = { month: 'Month', week: 'Week', day: 'Day', agenda: 'Agenda' };

export default function CalendarToolbar({ label, view, views, onNavigate, onView }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
      <div className="flex items-center gap-2">
        <button
          className="rounded-xl bg-slate-800 px-4 py-3 text-lg font-medium text-white active:bg-slate-700"
          onClick={() => onNavigate('TODAY')}
        >
          Today
        </button>
        <button
          className="rounded-xl bg-slate-200 px-4 py-3 text-lg font-medium text-slate-700 active:bg-slate-300"
          onClick={() => onNavigate('PREV')}
        >
          ‹
        </button>
        <button
          className="rounded-xl bg-slate-200 px-4 py-3 text-lg font-medium text-slate-700 active:bg-slate-300"
          onClick={() => onNavigate('NEXT')}
        >
          ›
        </button>
      </div>

      <h2 className="text-2xl font-semibold text-slate-900">{label}</h2>

      <div className="flex gap-2">
        {views.map((v) => (
          <button
            key={v}
            onClick={() => onView(v)}
            className={`rounded-xl px-4 py-3 text-lg font-medium ${
              v === view ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 active:bg-slate-300'
            }`}
          >
            {VIEW_LABELS[v] ?? v}
          </button>
        ))}
      </div>
    </div>
  );
}
