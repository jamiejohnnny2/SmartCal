import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

const WEEK_OPTS = { weekStartsOn: 0 };

export function monthGridDays(monthCursor) {
  const start = startOfWeek(startOfMonth(monthCursor), WEEK_OPTS);
  const end = endOfWeek(endOfMonth(monthCursor), WEEK_OPTS);
  return eachDayOfInterval({ start, end });
}

export function weekDays(anyDayInWeek) {
  const start = startOfWeek(anyDayInWeek, WEEK_OPTS);
  return eachDayOfInterval({ start, end: endOfWeek(anyDayInWeek, WEEK_OPTS) });
}

export function eventsOnDay(events, day) {
  return events
    .filter((e) => e.start < addDays(startOfDay(day), 1) && e.end > startOfDay(day))
    .sort((a, b) => a.start - b.start);
}

export function groupEventsByDay(events, days) {
  return days.map((day) => ({ day, events: eventsOnDay(events, day) }));
}

export { isSameDay, isSameMonth, format };
