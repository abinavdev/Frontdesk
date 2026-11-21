import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addWorkingMinutes, deadlines, workingMinutesBetween, endOfWorkingDay, isOverdue, withinReopenWindow, shiftDeadlines } from '../src/sla.js';
const empty = new Set();
const date = v => new Date(v);

test('Friday 18:00 high priority two-working-hour response lands Monday 11:00 IST', () => {
  const due = deadlines(date('2026-11-20T12:30:00Z'), 'high', empty);
  assert.equal(due.responseDue.toISOString(), '2026-11-23T05:30:00.000Z');
  assert.equal(due.resolutionDue.toISOString(), '2026-11-20T13:00:00.000Z');
});
test('a listed festival holiday is skipped', () => {
  const due = addWorkingMinutes(date('2026-11-20T12:30:00Z'), 120, new Set(['2026-11-23']));
  assert.equal(due.toISOString(), '2026-11-24T05:30:00.000Z');
});
test('business time excludes evenings and weekends', () => {
  assert.equal(workingMinutesBetween(date('2026-11-20T12:30Z'), date('2026-11-23T05:30Z'), empty), 120);
  assert.equal(workingMinutesBetween(date('2026-11-21T00:00Z'), date('2026-11-22T23:59Z'), empty), 0);
});
test('medium gets half working day to respond and three days to resolve', () => {
  const result = deadlines(date('2026-11-23T04:00:00Z'), 'medium', empty);
  assert.equal(result.responseDue.toISOString(), '2026-11-23T08:30:00.000Z');
  assert.equal(result.resolutionDue.toISOString(), '2026-11-25T13:00:00.000Z');
});
test('urgent requests after hours resolve next working day at closing', () => {
  assert.equal(endOfWorkingDay(date('2026-11-20T14:00Z'), empty).toISOString(), '2026-11-23T13:00:00.000Z');
});
test('waiting customer freezes SLA overdue flag', () => {
  const t = { status: 'waiting_customer', waiting_started_at: date('2026-11-20T10:00Z'), response_due_at: date('2026-11-23T05:00Z'), resolution_due_at: date('2026-11-25T13:00Z'), first_response_at: null };
  assert.equal(isOverdue(t, date('2026-12-01T00:00Z')), false);
});
test('resuming from customer wait shifts deadlines by business time only', () => {
  const t = { first_response_at: null, response_due_at: date('2026-11-23T05:00Z'), resolution_due_at: date('2026-11-25T13:00Z') };
  const shifted = shiftDeadlines(t, date('2026-11-20T12:30Z'), date('2026-11-23T05:30Z'), empty);
  assert.equal(shifted.responseDue.toISOString(), '2026-11-23T07:00:00.000Z');
});
test('reopen window excludes weekends', () => {
  assert.equal(withinReopenWindow(date('2026-11-20T12:00Z'), date('2026-11-27T12:00Z'), empty), true);
  assert.equal(withinReopenWindow(date('2026-11-20T12:00Z'), date('2026-11-30T12:01Z'), empty), false);
});
