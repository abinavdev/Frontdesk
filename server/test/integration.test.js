/** Run this test with TEST_DATABASE_URL pointing to a dedicated disposable PostgreSQL database.
 * It starts the actual HTTP API and exercises assignment concurrency, privacy and append-only history.
 * Example: TEST_DATABASE_URL=postgres://... npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const url = process.env.TEST_DATABASE_URL;
test('HTTP/database integration: atomic claim, private notes and immutable audit', { skip: !url && 'Set TEST_DATABASE_URL for database integration tests', timeout: 45000 }, async () => {
  const { Pool } = await import('pg');
  const port = 20000 + Math.floor(Math.random() * 30000);
  const base = `http://127.0.0.1:${port}/api`;
  const password = randomBytes(16).toString('hex');
  const env = { ...process.env, DATABASE_URL: url, SEED_AGENT_PASSWORD: password, SESSION_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'development', PORT: String(port) };
  const child = spawn(process.execPath, ['server/src/index.js'], { env, stdio: 'pipe' });
  const output = [];
  child.stderr.on('data', d => output.push(String(d)));
  const pool = new Pool({ connectionString: url });
  async function http(path, token, method='GET', data) {
    const response = await fetch(base+path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data ? JSON.stringify(data) : undefined });
    let body;
    try { body = await response.json(); } catch { body = {}; }
    return { status: response.status, body };
  }
  try {
    let ready = false;
    for (let i=0; i<120; i++) {
      if (child.exitCode !== null) throw Error(`Backend exited: ${output.join('')}`);
      try { if ((await http('/health')).status === 200) {ready=true;break;} } catch { /* not started yet */ }
      await new Promise(resolve => setTimeout(resolve,150));
    }
    assert.ok(ready, `Backend did not become ready: ${output.join('')}`);
    const a = await http('/auth/login', null, 'POST', { email: 'asha@arvo.example', password });
    const b = await http('/auth/login', null, 'POST', { email: 'ravi@arvo.example', password });
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    const reference = randomBytes(4).toString('hex');
    const create = await http('/public/tickets', null, 'POST', {
      subject:`Privacy check ${reference}`,description:'API integration test',customer_name:'Test Customer',customer_email:'customer@example.com',priority:'medium'
    });
    assert.equal(create.status, 201);
    const { ticket, customer_access_token: access } = create.body;
    const claims = await Promise.all([
      http(`/tickets/${ticket.id}/claim`, a.body.token, 'POST'),
      http(`/tickets/${ticket.id}/claim`, b.body.token, 'POST')
    ]);
    assert.deepEqual(claims.map(c=>c.status).sort(),[200,409]);
    const winningAgent = claims[0].status === 200 ? a.body.token : b.body.token;
    const privateText = `PRIVATE_DO_NOT_LEAK_${reference}`;
    assert.equal((await http(`/tickets/${ticket.id}/messages`, winningAgent, 'POST', {visibility:'internal',body:privateText})).status, 201);
    assert.equal((await http(`/tickets/${ticket.id}/messages`, winningAgent, 'POST', {visibility:'public',body:`Public reply ${reference}`})).status, 201);
    const customerView = await http(`/public/tickets/${ticket.id}`, access);
    assert.equal(customerView.status,200);
    assert.equal(JSON.stringify(customerView.body).includes(privateText), false);
    assert.equal(customerView.body.messages.length,1);
    assert.equal(customerView.body.messages[0].visibility,'public');
    assert.equal((await http(`/public/tickets/${ticket.id}`, 'wrong-token')).status, 401);
    const agentView = await http(`/tickets/${ticket.id}`, winningAgent);
    assert.equal(agentView.status,200);
    assert.equal(agentView.body.messages.some(m=>m.body===privateText),true);
    await assert.rejects(pool.query("UPDATE audit_events SET action='changed' WHERE ticket_id=$1",[ticket.id]), /append-only/i);
  } finally {
    child.kill('SIGTERM');
    await pool.end();
  }
});
