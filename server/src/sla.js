/**
 * Frontdesk business calendar. Working hours are Mon-Fri 09:30-18:30 IST.
 * Explicit holiday dates may be passed to all functions or set with HOLIDAYS.
 * IST has a fixed UTC+05:30 offset (no DST).
 */
const IST_OFFSET = 330 * 60000;
const START = 9 * 60 + 30;
const END = 18 * 60 + 30;
const DAY_MS = 86400000;

function wall(date) { return new Date(new Date(date).getTime() + IST_OFFSET); }
function utcFromWall(w) { return new Date(w.getTime() - IST_OFFSET); }
function dayString(w) { return w.toISOString().slice(0, 10); }
function minutesOfDay(w) { return w.getUTCHours() * 60 + w.getUTCMinutes(); }
function atMinute(w, minute) { const d = new Date(w); d.setUTCHours(Math.floor(minute / 60), minute % 60, 0, 0); return d; }
function nextDay(w) { const d = atMinute(w, 0); d.setTime(d.getTime() + DAY_MS); return d; }
export function holidaysFromEnv() { return new Set((process.env.HOLIDAYS || '').split(',').map(s => s.trim()).filter(Boolean)); }
export function isWorkingDay(date, holidays = holidaysFromEnv()) {
  const w = wall(date);
  return w.getUTCDay() >= 1 && w.getUTCDay() <= 5 && !holidays.has(dayString(w));
}
export function nextWorkingInstant(date, holidays = holidaysFromEnv()) {
  let w = wall(date);
  for (let i = 0; i < 370; i++) {
    if (isWorkingDay(utcFromWall(w), holidays)) {
      const minute = minutesOfDay(w);
      if (minute < START) return utcFromWall(atMinute(w, START));
      if (minute < END) return utcFromWall(w);
    }
    w = atMinute(nextDay(w), START);
  }
  throw new Error('Could not find a working day; check holiday configuration');
}
export function addWorkingMinutes(date, minutes, holidays = holidaysFromEnv()) {
  if (!Number.isFinite(minutes) || minutes < 0) throw new Error('minutes must be non-negative');
  let cursor = nextWorkingInstant(date, holidays);
  let remaining = Math.round(minutes * 60000);
  if (remaining === 0) return cursor;
  for (let i = 0; i < 4000; i++) {
    const w = wall(cursor);
    const end = utcFromWall(atMinute(w, END));
    const available = end.getTime() - cursor.getTime();
    if (remaining <= available) return new Date(cursor.getTime() + remaining);
    remaining -= available;
    cursor = nextWorkingInstant(new Date(end.getTime() + 1), holidays);
  }
  throw new Error('Working time exceeds supported range');
}
export function workingMinutesBetween(start, finish, holidays = holidaysFromEnv()) {
  const from = new Date(start).getTime();
  const to = new Date(finish).getTime();
  if (to <= from) return 0;
  let w = atMinute(wall(new Date(from)), 0);
  let totalMs = 0;
  for (let i = 0; w.getTime() - IST_OFFSET < to && i < 4000; i++, w = nextDay(w)) {
    if (!isWorkingDay(utcFromWall(w), holidays)) continue;
    const open = utcFromWall(atMinute(w, START)).getTime();
    const close = utcFromWall(atMinute(w, END)).getTime();
    totalMs += Math.max(0, Math.min(to, close) - Math.max(from, open));
  }
  return totalMs / 60000;
}
export function endOfWorkingDay(date, holidays = holidaysFromEnv()) {
  const next = nextWorkingInstant(date, holidays);
  return utcFromWall(atMinute(wall(next), END));
}
export function deadlines(start, priority, holidays = holidaysFromEnv()) {
  const response = { high: 120, medium: 270, low: 540 };
  const resolution = { medium: 3 * 540, low: 5 * 540 };
  if (!(priority in response)) throw new Error('Invalid priority');
  return {
    responseDue: addWorkingMinutes(start, response[priority], holidays),
    resolutionDue: priority === 'high' ? endOfWorkingDay(start, holidays) : addWorkingMinutes(start, resolution[priority], holidays)
  };
}
export function shiftDeadlines(ticket, pauseStart, resumeAt, holidays = holidaysFromEnv()) {
  const paused = workingMinutesBetween(pauseStart, resumeAt, holidays);
  return {
    responseDue: ticket.first_response_at || paused === 0 ? new Date(ticket.response_due_at) : addWorkingMinutes(ticket.response_due_at, paused, holidays),
    resolutionDue: paused === 0 ? new Date(ticket.resolution_due_at) : addWorkingMinutes(ticket.resolution_due_at, paused, holidays)
  };
}
export function isOverdue(ticket, now = new Date()) {
  if (ticket.status === 'closed' || ticket.status === 'resolved') return false;
  const effectiveTime = ticket.status === 'waiting_customer' && ticket.waiting_started_at ? new Date(ticket.waiting_started_at) : now;
  const responseLate = !ticket.first_response_at && effectiveTime > new Date(ticket.response_due_at);
  return responseLate || effectiveTime > new Date(ticket.resolution_due_at);
}
export function withinReopenWindow(resolvedAt, now = new Date(), holidays = holidaysFromEnv()) {
  return new Date(now) <= addWorkingMinutes(resolvedAt, 5 * 540, holidays);
}
