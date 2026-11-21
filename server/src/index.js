import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction, audit, initializeDatabase } from './db.js';
import { customerToken, hashToken, hashPassword, verifyPassword, signAgentSession, verifyAgentSession } from './security.js';
import { deadlines, addWorkingMinutes, shiftDeadlines, isOverdue, withinReopenWindow } from './sla.js';

const production = process.env.NODE_ENV === 'production';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (production && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) throw new Error('A SESSION_SECRET of at least 32 characters is required in production');
if (production && (!process.env.SEED_AGENT_PASSWORD || process.env.SEED_AGENT_PASSWORD.length < 12)) throw new Error('A SEED_AGENT_PASSWORD of at least 12 characters is required in production');
const secret = process.env.SESSION_SECRET || 'dev-only-session-secret-not-for-production';
const ashaPasswordHash = process.env.ASHA_AGENT_PASSWORD
  ? hashPassword(process.env.ASHA_AGENT_PASSWORD)
  : null;
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store'); next(); });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const invalid = (message, status = 400) => Object.assign(new Error(message), { status });
const validId = id => { if (!/^[1-9]\d{0,14}$/.test(String(id))) throw invalid('Invalid ticket id'); return id; };
const validBody = value => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 5000;
const validPriority = value => ['high','medium','low'].includes(value);
const label = ticket => `FD-${String(ticket.id).padStart(5, '0')}`;
const own = (ticket, agent) => {
  if (String(ticket.assignee_id) !== String(agent.id)) throw invalid('Claim this ticket before making changes', 403);
};
function ticketJSON(ticket) {
  const { customer_token_hash, ...data } = ticket;
  return { ...data, code: label(ticket), is_overdue: isOverdue(ticket),
    response_breached: !!ticket.first_response_at && new Date(ticket.first_response_at) > new Date(ticket.response_due_at),
    resolution_breached: !!ticket.resolved_at && new Date(ticket.resolved_at) > new Date(ticket.resolution_due_at) }; 
}
const selectTicket = async (client, id, lock = false) => {
  const result = await client.query(`SELECT t.*, a.display_name AS assignee_name FROM tickets t LEFT JOIN agents a ON a.id=t.assignee_id WHERE t.id=$1 ${lock ? 'FOR UPDATE OF t' : ''}`, [validId(id)]);
  if (!result.rows[0]) throw invalid('Ticket not found', 404);
  return result.rows[0];
};
async function customerTicket(client, id, token, lock = false) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw invalid('Customer access token required', 401);
  const ticket = await selectTicket(client, id, lock);
  if (hashToken(token) !== ticket.customer_token_hash) throw invalid('Ticket not found', 404);
  return ticket;
}
const customerAccess = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
function requireAgent(req, res, next) {
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const session = verifyAgentSession(auth, secret);
  if (!session) return res.status(401).json({ error: 'Please sign in again' });
  req.agent = session;
  next();
}
async function createTicket(client, input, actor) {
  const subject = String(input.subject || '').trim();
  const description = String(input.description || '').trim();
  const customerName = String(input.customer_name || '').trim();
  const customerEmail = String(input.customer_email || '').trim();
  const priority = input.priority || 'medium';
  if (subject.length < 3 || subject.length > 180 || !validBody(description) || !customerName || customerName.length > 120 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customerEmail) || !validPriority(priority)) {
    throw invalid('Provide a subject (3–180 characters), description, customer name, valid email and priority');
  }
  const now = new Date();
  const due = deadlines(now, priority);
  const token = customerToken();
  const result = await client.query(`INSERT INTO tickets (subject, description, customer_name, customer_email, customer_token_hash, priority, response_due_at, resolution_due_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [subject, description, customerName, customerEmail, hashToken(token), priority, due.responseDue, due.resolutionDue]);
  const ticket = result.rows[0];
  await audit(client, ticket.id, actor?.id ?? null, actor ? null : customerEmail, 'ticket_created', { priority, subject });
  return { ticket: ticketJSON(ticket), customer_access_token: token };
}
async function resumeFromWait(client, ticket, now) {
  if (ticket.status !== 'waiting_customer') return;
  const shifted = shiftDeadlines(ticket, ticket.waiting_started_at, now);
  await client.query(`UPDATE tickets SET status='in_progress', waiting_started_at=NULL, auto_close_at=NULL,
      response_due_at=$2, resolution_due_at=$3, updated_at=$4 WHERE id=$1`, [ticket.id, shifted.responseDue, shifted.resolutionDue, now]);
}
async function reopenTicket(client, ticket, now, actor) {
  if (ticket.status !== 'resolved') throw invalid('Only resolved tickets may be reopened', 409);
  if (!ticket.resolved_at || !withinReopenWindow(ticket.resolved_at, now)) throw invalid('The five-working-day reopen window has expired; create a new ticket', 409);
  const shifted = shiftDeadlines(ticket, ticket.resolved_at, now);
  await client.query(`UPDATE tickets SET status='in_progress', resolved_at=NULL, updated_at=$2,
    response_due_at=$3, resolution_due_at=$4 WHERE id=$1`, [ticket.id, now, shifted.responseDue, shifted.resolutionDue]);
  await audit(client, ticket.id, actor?.id ?? null, actor ? null : ticket.customer_email, 'ticket_reopened', {});
}
async function sweepStaleTickets() {
  return withTransaction(async client => {
    const closed = await client.query(`UPDATE tickets SET status='closed', closed_at=now(), waiting_started_at=NULL,
      auto_close_at=NULL, updated_at=now() WHERE status='waiting_customer' AND auto_close_at <= now()
      RETURNING id`);
    for (const row of closed.rows) await audit(client, row.id, null, 'system', 'ticket_auto_closed', { reason: 'No customer response for five working days' });
    return closed.rowCount;
  });
}
app.get('/api/health', wrap(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, service: 'frontdesk', now: new Date().toISOString() });
}));
app.post('/api/auth/login', wrap(async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const password = String(req.body?.password || '');
  const result = await pool.query('SELECT id,email,display_name,password_hash FROM agents WHERE email=$1', [email]);
  const user = result.rows[0];
  const passwordHash = email === 'asha@arvo.example' && ashaPasswordHash
    ? ashaPasswordHash
    : user?.password_hash;
  if (!user || !verifyPassword(password, passwordHash)) throw invalid('Invalid email or password', 401);
  const agent = { id: user.id, email: user.email, display_name: user.display_name };
  res.json({ agent, token: signAgentSession(agent, secret) });
}));

// Customer-facing API is intentionally separate from the agent API.
// Every customer read uses an explicit field allowlist and visibility='public'.
app.post('/api/public/tickets', wrap(async (req, res) => {
  const created = await withTransaction(client => createTicket(client, req.body || {}, null));
  res.status(201).json(created);
}));
app.get('/api/public/tickets/:id', wrap(async (req, res) => {
  await sweepStaleTickets();
  const ticket = await customerTicket(pool, req.params.id, customerAccess(req));
  const messages = await pool.query(`SELECT m.id, m.body, m.created_at, m.visibility, COALESCE(a.display_name,m.author_customer) AS author
    FROM messages m LEFT JOIN agents a ON a.id=m.author_agent_id
    WHERE m.ticket_id=$1 AND m.visibility='public' ORDER BY m.created_at ASC, m.id ASC`, [ticket.id]);
  res.json({ ticket: { id: ticket.id, code: label(ticket), subject: ticket.subject, description: ticket.description,
    priority: ticket.priority, status: ticket.status, created_at: ticket.created_at, updated_at: ticket.updated_at }, messages: messages.rows });
}));
app.post('/api/public/tickets/:id/reply', wrap(async (req, res) => {
  await sweepStaleTickets();
  const body = String(req.body?.body || '').trim();
  if (!validBody(body)) throw invalid('Reply must contain between 1 and 5000 characters');
  const result = await withTransaction(async client => {
    const t = await customerTicket(client, req.params.id, customerAccess(req), true);
    if (['closed','resolved'].includes(t.status)) throw invalid('Ticket is not accepting replies; reopen if eligible', 409);
    const now = new Date();
    await resumeFromWait(client, t, now);
    await client.query(`INSERT INTO messages (ticket_id, author_customer, visibility, body) VALUES ($1,$2,'public',$3)`, [t.id, t.customer_email, body]);
    await client.query('UPDATE tickets SET updated_at=$2 WHERE id=$1', [t.id, now]);
    if (t.status === 'waiting_customer') await audit(client, t.id, null, t.customer_email, 'customer_wait_ended', {});
    await audit(client, t.id, null, t.customer_email, 'customer_replied', {});
    return { ok: true };
  });
  res.status(201).json(result);
}));
app.post('/api/public/tickets/:id/reopen', wrap(async (req, res) => {
  await sweepStaleTickets();
  await withTransaction(async client => {
    const ticket = await customerTicket(client, req.params.id, customerAccess(req), true);
    await reopenTicket(client, ticket, new Date(), null);
  });
  res.json({ ok: true });
}));

app.use('/api/agents', requireAgent);
app.use('/api/tickets', requireAgent);
app.get('/api/agents', wrap(async (req, res) => {
  const result = await pool.query('SELECT id, email, display_name FROM agents ORDER BY id');
  res.json({ agents: result.rows });
}));
app.get('/api/tickets', wrap(async (req, res) => {
  await sweepStaleTickets();
  const filter = String(req.query.filter || 'all');
  if (!['all','mine','unassigned','waiting','overdue','resolved'].includes(filter)) throw invalid('Invalid filter');
  const q = String(req.query.search || '').trim().slice(0, 100);
  const conditions = [];
  const params = [];
  if (filter === 'mine') { params.push(req.agent.id); conditions.push(`t.assignee_id=$${params.length}`); }
  if (filter === 'unassigned') conditions.push('t.assignee_id IS NULL');
  if (filter === 'waiting') conditions.push("t.status='waiting_customer'");
  if (filter === 'resolved') conditions.push("t.status IN ('resolved','closed')");
  if (q) { params.push(`%${q}%`); conditions.push(`(t.subject ILIKE $${params.length} OR t.customer_email ILIKE $${params.length} OR CAST(t.id AS TEXT) ILIKE $${params.length})`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(`SELECT t.*, a.display_name AS assignee_name FROM tickets t LEFT JOIN agents a ON a.id=t.assignee_id ${where} ORDER BY t.updated_at DESC LIMIT 200`, params);
  const data = result.rows.map(ticketJSON).filter(t => filter !== 'overdue' || t.is_overdue);
  res.json({ tickets: data });
}));
app.post('/api/tickets', wrap(async (req, res) => {
  const created = await withTransaction(client => createTicket(client, req.body || {}, req.agent));
  res.status(201).json(created);
}));
app.get('/api/tickets/:id', wrap(async (req, res) => {
  await sweepStaleTickets();
  const ticket = await selectTicket(pool, req.params.id);
  const [messages, events] = await Promise.all([
    pool.query(`SELECT m.id,m.body,m.visibility,m.created_at,
       COALESCE(a.display_name,m.author_customer) AS author FROM messages m
       LEFT JOIN agents a ON a.id=m.author_agent_id WHERE m.ticket_id=$1 ORDER BY m.created_at, m.id`, [ticket.id]),
    pool.query(`SELECT e.id,e.action,e.details,e.happened_at,COALESCE(a.display_name,e.actor_customer,'System') AS actor
       FROM audit_events e LEFT JOIN agents a ON a.id=e.actor_agent_id WHERE e.ticket_id=$1 ORDER BY e.happened_at,e.id`, [ticket.id])
  ]);
  res.json({ ticket: ticketJSON(ticket), messages: messages.rows, events: events.rows });
}));
app.post('/api/tickets/:id/claim', wrap(async (req, res) => {
  const ticket = await withTransaction(async client => {
    // Atomic conditional update is the double-claim incident safeguard.
    const result = await client.query(`UPDATE tickets SET assignee_id=$2, status=CASE WHEN status='open' THEN 'in_progress' ELSE status END,
      updated_at=now() WHERE id=$1 AND assignee_id IS NULL AND status IN ('open','in_progress') RETURNING *`, [validId(req.params.id), req.agent.id]);
    if (!result.rows[0]) throw invalid('Already claimed, unavailable or not found', 409);
    await audit(client, result.rows[0].id, req.agent.id, null, 'ticket_claimed', {});
    return result.rows[0];
  });
  res.json({ ticket: ticketJSON(ticket) });
}));
app.post('/api/tickets/:id/priority', wrap(async (req, res) => {
  const priority = String(req.body?.priority || '');
  if (!validPriority(priority)) throw invalid('Invalid priority');
  const ticket = await withTransaction(async client => {
    const t = await selectTicket(client, req.params.id, true);
    own(t, req.agent);
    if (['resolved','closed'].includes(t.status)) throw invalid('Cannot change priority on resolved or closed ticket', 409);
    const now = new Date();
    if (priority === t.priority) return t;
    const due = deadlines(now, priority);
    const result = await client.query(`UPDATE tickets SET priority=$2, response_due_at=$3, resolution_due_at=$4,
        waiting_started_at=CASE WHEN status='waiting_customer' THEN $5 ELSE waiting_started_at END,
        updated_at=$5 WHERE id=$1 RETURNING *`, [t.id, priority, due.responseDue, due.resolutionDue, now]);
    await audit(client, t.id, req.agent.id, null, 'priority_changed', { from: t.priority, to: priority, policy: 'reset-SLA-from-change' });
    return result.rows[0];
  });
  res.json({ ticket: ticketJSON(ticket) });
}));
app.post('/api/tickets/:id/messages', wrap(async (req, res) => {
  const body = String(req.body?.body || '').trim();
  const visibility = req.body?.visibility;
  if (!validBody(body) || !['public','internal'].includes(visibility)) throw invalid('A message and its visibility (public/internal) are required');
  await withTransaction(async client => {
    const t = await selectTicket(client, req.params.id, true);
    own(t, req.agent);
    if (['closed','resolved'].includes(t.status)) throw invalid('Cannot reply to a resolved or closed ticket', 409);
    const now = new Date();
    await client.query(`INSERT INTO messages (ticket_id,author_agent_id,visibility,body) VALUES ($1,$2,$3,$4)`, [t.id, req.agent.id, visibility, body]);
    await client.query(`UPDATE tickets SET first_response_at=CASE WHEN $2='public' AND first_response_at IS NULL THEN $3 ELSE first_response_at END,
      updated_at=$3 WHERE id=$1`, [t.id, visibility, now]);
    // Never include message contents in the audit payload; an export of events cannot leak internal notes.
    await audit(client, t.id, req.agent.id, null, visibility === 'internal' ? 'internal_note_added' : 'public_reply_sent', { visibility,
      first_response_sla_breached: visibility === 'public' && !t.first_response_at && now > new Date(t.response_due_at) });
  });
  res.status(201).json({ ok: true });
}));
app.post('/api/tickets/:id/status', wrap(async (req, res) => {
  const requested = String(req.body?.status || '');
  if (!['in_progress','waiting_customer','resolved'].includes(requested)) throw invalid('Unsupported status');
  const ticket = await withTransaction(async client => {
    const t = await selectTicket(client, req.params.id, true);
    own(t, req.agent);
    if (['closed','resolved'].includes(t.status)) throw invalid('Use the reopen action on resolved tickets', 409);
    if (t.status === requested) return t;
    const now = new Date();
    if (t.status === 'waiting_customer') await resumeFromWait(client, t, now);
    if (requested === 'waiting_customer') {
      if (t.status === 'waiting_customer') return t;
      await client.query(`UPDATE tickets SET status='waiting_customer', waiting_started_at=$2,
         auto_close_at=$3, updated_at=$2 WHERE id=$1`, [t.id, now, addWorkingMinutes(now, 5 * 540)]);
    } else if (requested === 'resolved') {
      await client.query(`UPDATE tickets SET status='resolved', resolved_at=$2,
        waiting_started_at=NULL,auto_close_at=NULL,updated_at=$2 WHERE id=$1`, [t.id, now]);
    } else {
      await client.query(`UPDATE tickets SET status='in_progress',updated_at=$2 WHERE id=$1`, [t.id, now]);
    }
    await audit(client, t.id, req.agent.id, null, 'status_changed', { from: t.status, to: requested,
      resolution_sla_breached: requested === 'resolved' && now > new Date(t.resolution_due_at) });
    return (await selectTicket(client, t.id)).id;
  });
  res.json({ ok: true, ticket_id: ticket });
}));
app.post('/api/tickets/:id/reopen', wrap(async (req, res) => {
  await withTransaction(async client => {
    const t = await selectTicket(client, req.params.id, true);
    own(t, req.agent);
    await reopenTicket(client, t, new Date(), req.agent);
  });
  res.json({ ok: true });
}));

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
app.use(express.static(dist, { index: false, maxAge: '1h' }));
app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
app.use((err, req, res, next) => {
  if (err.code === '23514') return res.status(400).json({ error: 'Invalid ticket data' });
  console.error('Request error:', err.message);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Unexpected server error' });
});

await initializeDatabase();
const server = app.listen(Number(process.env.PORT || 3001), '0.0.0.0', () => console.info(`Frontdesk listening on ${process.env.PORT || 3001}`));
const sweepTimer = setInterval(() => sweepStaleTickets().catch(err => console.error('Auto-close:', err.message)), 15 * 60 * 1000);
sweepTimer.unref();
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, async () => { clearInterval(sweepTimer); server.close(); await pool.end(); process.exit(0); });
