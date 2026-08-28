import { dateFnsLocalizer, Calendar as BigCalendar } from 'react-big-calendar';
import format from 'date-fns/format';
import parse from 'date-fns/parse';
import startOfWeek from 'date-fns/startOfWeek';
import getDay from 'date-fns/getDay';
import enUS from 'date-fns/locale/en-US';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import CalendarToolbar from './CalendarToolbar.jsx';

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { locale: enUS }),
  getDay,
  locales: { 'en-US': enUS },
});

export default function CalendarView({ events, view, date, onView, onNavigate, onSelectSlot, onSelectEvent }) {
  return (
    <div className="flex-1 min-h-0">
      <BigCalendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        view={view}
        date={date}
        onView={onView}
        onNavigate={onNavigate}
        selectable
        onSelectSlot={onSelectSlot}
        onSelectEvent={onSelectEvent}
        views={['month', 'week', 'day', 'agenda']}
        components={{ toolbar: CalendarToolbar }}
        eventPropGetter={(event) => ({
          style: {
            backgroundColor: event.color || '#2563eb',
            borderRadius: '6px',
            border: 'none',
          },
        })}
        style={{ height: '100%' }}
      />
    </div>
  );
}
